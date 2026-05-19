from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from datetime import datetime, timedelta
from app import db
from app.models.match import Match, Odds
from app.services.odds_service import OddsService, translate_team, translate_league
from app.services.football_api import FootballDataAPI

matches_bp = Blueprint('matches', __name__)


def sync_schedule_data(days=7):
    """Sync match schedules into the local database."""
    api = FootballDataAPI()
    matches_data = api.get_popular_leagues_matches(days=days)

    if not matches_data:
        error = api.last_error or '未获取到可同步的赛程数据'
        status_code = 400 if 'FOOTBALL_DATA_API_KEY' in error else 502
        return {
            'status': 'failed',
            'error': error,
            'synced': 0,
            'skipped': 0,
            'total_found': 0,
            'leagues': {},
            'league_summary': '无'
        }, status_code

    synced = 0
    skipped = 0
    leagues = {}

    for event in matches_data:
        ext_id = event['external_id']

        existing = Match.query.filter_by(external_id=ext_id).first()
        if existing:
            skipped += 1
            continue

        home_cn = translate_team(event['home_team'])
        away_cn = translate_team(event['away_team'])
        league_cn = event.get('league_cn') or translate_league(event['league'])

        match = Match(
            external_id=ext_id,
            sport='soccer',
            league=league_cn,
            home_team=home_cn,
            away_team=away_cn,
            start_time=datetime.fromisoformat(event['start_time']),
            status=event.get('status', 'upcoming'),
            home_score=event.get('home_score'),
            away_score=event.get('away_score')
        )
        db.session.add(match)
        synced += 1
        leagues[league_cn] = leagues.get(league_cn, 0) + 1

    db.session.commit()

    league_summary = '、'.join([f"{k}({v}场)" for k, v in leagues.items()]) if leagues else '无'

    return {
        'status': 'success',
        'message': f'赛程同步完成：新增 {synced} 场，跳过 {skipped} 场已存在',
        'synced': synced,
        'skipped': skipped,
        'total_found': len(matches_data),
        'leagues': leagues,
        'league_summary': league_summary
    }, 200

@matches_bp.route('/', methods=['GET'])
def get_matches():
    """获取比赛列表，支持日期筛选"""
    sport = request.args.get('sport', 'soccer')
    league = request.args.get('league', None)
    date = request.args.get('date', 'today')  # today, tomorrow, all
    show_finished = request.args.get('show_finished', 'true').lower() == 'true'

    query = Match.query.filter_by(sport=sport)

    # 根据参数决定是否显示已结束比赛
    if not show_finished:
        query = query.filter(Match.status.in_(['upcoming', 'live']))

    # 日期筛选（使用北京时间 UTC+8，与前端显示一致）
    beijing_offset = timedelta(hours=8)
    now_utc = datetime.utcnow()
    # 北京时间今天 00:00 对应的 UTC 时间
    today_start_utc = (now_utc + beijing_offset).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - beijing_offset
    today_end_utc = today_start_utc + timedelta(days=1)
    tomorrow_end_utc = today_end_utc + timedelta(days=1)

    if date == 'today':
        query = query.filter(
            Match.start_time >= today_start_utc,
            Match.start_time < today_end_utc
        )
    elif date == 'tomorrow':
        query = query.filter(
            Match.start_time >= today_end_utc,
            Match.start_time < tomorrow_end_utc
        )
    # date == 'all' 时不添加日期过滤

    if league:
        query = query.filter_by(league=league)

    matches = query.order_by(Match.start_time).all()
    return jsonify({
        'matches': [m.to_dict(include_odds=False) for m in matches],
        'count': len(matches),
        'date_filter': date
    })

@matches_bp.route('/<int:match_id>', methods=['GET'])
def get_match(match_id):
    """获取单场比赛详情"""
    match = Match.query.get_or_404(match_id)
    return jsonify({'match': match.to_dict()})

@matches_bp.route('/leagues', methods=['GET'])
def get_leagues():
    """获取所有联赛列表"""
    leagues = db.session.query(Match.league).distinct().all()
    return jsonify({'leagues': [l[0] for l in leagues]})

@matches_bp.route('/sync', methods=['POST'])
@jwt_required()
def sync_matches():
    """从 The Odds API 同步真实赔率数据（需要登录，需要 API Key）"""
    force = request.args.get('force', 'false').lower() == 'true'
    odds_service = OddsService()
    result = odds_service.sync_upcoming_matches(force=force)
    if 'error' not in result:
        status_code = 200
    elif 'ODDS_API_KEY' in result['error']:
        status_code = 400
    else:
        status_code = 502
    return jsonify(result), status_code

@matches_bp.route('/sync-schedule', methods=['POST'])
@jwt_required()
def sync_schedule():
    """从 football-data.org 同步真实赛程数据（需要 FOOTBALL_DATA_API_KEY）"""
    days = request.args.get('days', 7, type=int)
    result, status_code = sync_schedule_data(days=days)
    return jsonify(result), status_code

@matches_bp.route('/sync-all', methods=['POST'])
@jwt_required()
def sync_all():
    """一键同步：先拉赛程，再拉赔率"""
    days = request.args.get('days', 7, type=int)

    results = {}
    schedule_result, schedule_status = sync_schedule_data(days=days)
    results['schedule'] = schedule_result

    # Step 2: 同步赔率
    odds_service = OddsService()
    odds_result = odds_service.sync_upcoming_matches(force=True)
    results['odds'] = odds_result

    schedule_message = schedule_result.get('message')
    if not schedule_message:
        schedule_message = f"赛程未同步：{schedule_result.get('error', '未知错误')}"

    odds_message = odds_result.get('message')
    if not odds_message:
        odds_message = f"赔率未同步：{odds_result.get('error', '未知错误')}"

    response = {
        'message': f'一键同步完成：{schedule_message}；{odds_message}',
        'results': results
    }

    if schedule_status != 200 and 'error' in odds_result:
        status_code = 502
    else:
        status_code = 200

    return jsonify(response), status_code

@matches_bp.route('/validate-odds', methods=['GET'])
def validate_odds():
    """赔率验证：对比同一比赛不同博彩公司的真实赔率差异"""
    matches = Match.query.filter_by(status='upcoming').all()

    results = []
    for match in matches:
        all_odds = Odds.query.filter_by(match_id=match.id, market='h2h').all()

        if len(all_odds) < 2:
            continue

        home_odds_list = [float(o.home_odds) for o in all_odds if o.home_odds]
        draw_odds_list = [float(o.draw_odds) for o in all_odds if o.draw_odds]
        away_odds_list = [float(o.away_odds) for o in all_odds if o.away_odds]

        def calc_stats(odds_list):
            if not odds_list:
                return None
            avg = sum(odds_list) / len(odds_list)
            return {
                'avg': round(avg, 2),
                'min': round(min(odds_list), 2),
                'max': round(max(odds_list), 2),
                'spread': round((max(odds_list) - min(odds_list)) / avg * 100, 2),
                'count': len(odds_list)
            }

        home_stats = calc_stats(home_odds_list)
        draw_stats = calc_stats(draw_odds_list)
        away_stats = calc_stats(away_odds_list)

        # 最大偏差率
        spreads = [s['spread'] for s in [home_stats, draw_stats, away_stats] if s]
        max_spread = max(spreads) if spreads else 0

        # 各博彩公司明细
        bookmakers = []
        for o in all_odds:
            bookmakers.append({
                'bookmaker': o.bookmaker,
                'home_odds': float(o.home_odds) if o.home_odds else None,
                'draw_odds': float(o.draw_odds) if o.draw_odds else None,
                'away_odds': float(o.away_odds) if o.away_odds else None,
            })

        results.append({
            'match_id': match.id,
            'home_team': match.home_team,
            'away_team': match.away_team,
            'league': match.league,
            'bookmakers_count': len(all_odds),
            'home': home_stats,
            'draw': draw_stats,
            'away': away_stats,
            'max_spread': round(max_spread, 2),
            'is_valid': max_spread < 15,  # 偏差小于 15% 视为正常
            'bookmakers': bookmakers
        })

    # 按偏差率排序，异常的排前面
    results.sort(key=lambda x: x['max_spread'], reverse=True)

    valid_count = sum(1 for r in results if r['is_valid'])
    invalid_count = sum(1 for r in results if not r['is_valid'])

    return jsonify({
        'total': len(results),
        'valid': valid_count,
        'invalid': invalid_count,
        'results': results
    })
