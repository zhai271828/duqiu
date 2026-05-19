from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import func
from app import db
from app.models.user import User
from app.models.bet import Bet
from app.models.match import Match

stats_bp = Blueprint('stats', __name__)

@stats_bp.route('/me', methods=['GET'])
@jwt_required()
def get_my_stats():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)

    total_bets = Bet.query.filter_by(user_id=user_id).count()
    won_bets = Bet.query.filter_by(user_id=user_id, status='won').count()
    lost_bets = Bet.query.filter_by(user_id=user_id, status='lost').count()
    pending_bets = Bet.query.filter_by(user_id=user_id, status='pending').count()

    total_wagered = db.session.query(func.sum(Bet.amount)).filter_by(user_id=user_id).scalar() or 0
    total_profit = db.session.query(func.sum(Bet.profit)).filter(
        Bet.user_id == user_id,
        Bet.status.in_(['won', 'lost'])
    ).scalar() or 0

    win_rate = (won_bets / total_bets * 100) if total_bets > 0 else 0

    return jsonify({
        'balance': float(user.balance),
        'total_bets': total_bets,
        'won_bets': won_bets,
        'lost_bets': lost_bets,
        'pending_bets': pending_bets,
        'total_wagered': float(total_wagered),
        'total_profit': float(total_profit),
        'win_rate': round(win_rate, 2)
    })

@stats_bp.route('/leaderboard', methods=['GET'])
def get_leaderboard():
    users = User.query.all()

    leaderboard = []
    for user in users:
        total_bets = Bet.query.filter_by(user_id=user.id).count()
        won_bets = Bet.query.filter_by(user_id=user.id, status='won').count()
        lost_bets = Bet.query.filter_by(user_id=user.id, status='lost').count()

        total_wagered = db.session.query(func.sum(Bet.amount)).filter_by(user_id=user.id).scalar() or 0
        total_profit = db.session.query(func.sum(Bet.profit)).filter(
            Bet.user_id == user.id,
            Bet.status.in_(['won', 'lost'])
        ).scalar() or 0

        # 计算盈利率（相对于初始资金 10000）
        initial_balance = 10000
        profit_rate = ((float(user.balance) - initial_balance) / initial_balance * 100)

        # 胜率
        win_rate = round((won_bets / total_bets * 100) if total_bets > 0 else 0, 2)

        # 综合评分 = 盈利率 × 0.4 + 胜率 × 0.3 + 下注次数权重 × 0.3
        # 下注次数权重：log2(total_bets + 1) * 10，最多 100 分
        import math
        bet_weight = min(math.log2(total_bets + 1) * 10, 100)
        score = round(profit_rate * 0.4 + win_rate * 0.3 + bet_weight * 0.3, 1)

        leaderboard.append({
            'user_id': user.id,
            'username': user.username,
            'balance': float(user.balance),
            'total_bets': total_bets,
            'won_bets': won_bets,
            'lost_bets': lost_bets,
            'total_profit': float(total_profit),
            'profit_rate': round(profit_rate, 2),
            'win_rate': win_rate,
            'score': score
        })

    # 按综合评分排序
    leaderboard.sort(key=lambda x: x['score'], reverse=True)

    # 添加排名
    for i, item in enumerate(leaderboard, 1):
        item['rank'] = i

    return jsonify({'leaderboard': leaderboard})

@stats_bp.route('/homepage', methods=['GET'])
def get_homepage_stats():
    """首页统计数据"""
    total_users = User.query.count()
    total_bets = Bet.query.count()
    total_matches = Match.query.filter_by(status='upcoming', sport='soccer').count()

    return jsonify({
        'totalUsers': total_users,
        'totalBets': total_bets,
        'totalMatches': total_matches
    })
