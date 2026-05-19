"""
数据初始化脚本

直接在应用上下文里初始化数据库并同步数据，不依赖本地先跑起后端服务。
"""
import os
import sys
from datetime import datetime

# 添加后端路径到 Python 路径
ROOT_DIR = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(ROOT_DIR, 'backend'))

from app import create_app, db
from app.models.match import Match
from app.models.user import User
from app.services.football_api import FootballDataAPI
from app.services.odds_service import OddsService, translate_league, translate_team


def ensure_admin_user():
    """Create the default admin user when the database is empty."""
    if User.query.filter_by(username='admin').first():
        user_count = User.query.count()
        print(f"  用户已存在: {user_count} 个")
        return

    user = User(
        username='admin',
        email='admin@test.com',
        email_verified=True
    )
    user.set_password('change-me-admin-password')
    db.session.add(user)
    db.session.commit()
    print(f"  创建测试用户: admin (余额: {user.balance})")


def sync_schedule(days=7):
    """Sync schedules when football-data.org is configured."""
    api = FootballDataAPI()
    matches_data = api.get_popular_leagues_matches(days=days)

    if not matches_data:
        if api.last_error:
            print(f"  赛程同步跳过/失败: {api.last_error}")
        else:
            print("  没有获取到可同步的赛程数据")
        return

    synced = 0
    skipped = 0

    for event in matches_data:
        existing = Match.query.filter_by(external_id=event['external_id']).first()
        if existing:
            skipped += 1
            continue

        match = Match(
            external_id=event['external_id'],
            sport='soccer',
            league=event.get('league_cn') or translate_league(event['league']),
            home_team=translate_team(event['home_team']),
            away_team=translate_team(event['away_team']),
            start_time=datetime.fromisoformat(event['start_time']),
            status=event.get('status', 'upcoming'),
            home_score=event.get('home_score'),
            away_score=event.get('away_score')
        )
        db.session.add(match)
        synced += 1

    db.session.commit()
    print(f"  赛程同步完成: 新增 {synced} 场，跳过 {skipped} 场")


def sync_odds():
    """Sync odds and any matches returned by The Odds API."""
    result = OddsService().sync_upcoming_matches(force=True)
    if 'error' in result:
        print(f"  赔率同步跳过/失败: {result['error']}")
        return

    print(f"  赔率同步完成: 更新 {result.get('synced', 0)} 场，跳过 {result.get('skipped', 0)} 场")
    if 'api_remaining' in result:
        print(f"  API 剩余请求次数: {result['api_remaining']}")


def show_summary(limit=5):
    """Print a short database summary."""
    matches = Match.query.filter_by(sport='soccer').order_by(Match.start_time).all()
    print(f"\n  数据库中共 {len(matches)} 场足球比赛")
    for match in matches[:limit]:
        odds_info = f"{len(match.odds)} 家博彩公司赔率" if match.odds else "暂无赔率"
        print(f"    {match.home_team} vs {match.away_team} ({match.league}) - {odds_info}")
    if len(matches) > limit:
        print(f"    ... 还有 {len(matches) - limit} 场")


def main():
    app = create_app('development')

    print("=" * 50)
    print("模拟赌球 - 数据初始化")
    print("=" * 50)

    with app.app_context():
        print("\n[1/3] 初始化数据库...")
        db.create_all()
        ensure_admin_user()

        print("\n[2/3] 同步赛程（可选，需要 FOOTBALL_DATA_API_KEY）...")
        sync_schedule()

        print("\n[3/3] 同步赔率（需要 ODDS_API_KEY）...")
        sync_odds()

        show_summary()

    print("\n" + "=" * 50)
    print("完成！")
    print("前端: http://localhost:3000")
    print("后端: http://localhost:5000")
    print("=" * 50)


if __name__ == '__main__':
    main()
