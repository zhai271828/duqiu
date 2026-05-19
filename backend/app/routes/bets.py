from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models.user import User
from app.models.match import Match, Odds
from app.models.bet import Bet

bets_bp = Blueprint('bets', __name__)

@bets_bp.route('/', methods=['POST'])
@jwt_required()
def place_bet():
    user_id = int(get_jwt_identity())
    data = request.get_json()

    if not data or not all(k in data for k in ['match_id', 'selection', 'odds', 'amount']):
        return jsonify({'error': '请填写所有必填字段'}), 400

    user = User.query.get(user_id)
    match = Match.query.get(data['match_id'])

    if not user:
        return jsonify({'error': '用户不存在'}), 404

    if not match:
        return jsonify({'error': '比赛不存在'}), 404

    if match.status != 'upcoming':
        return jsonify({'error': '比赛已开始或结束'}), 400

    amount = float(data['amount'])
    if amount <= 0:
        return jsonify({'error': '下注金额必须大于0'}), 400

    if amount > float(user.balance):
        return jsonify({'error': '余额不足'}), 400

    odds = float(data['odds'])
    potential_win = amount * odds

    bet = Bet(
        user_id=user_id,
        match_id=data['match_id'],
        bet_type=data.get('bet_type', 'h2h'),
        selection=data['selection'],
        odds=odds,
        amount=amount,
        potential_win=potential_win
    )

    user.balance = float(user.balance) - amount

    db.session.add(bet)
    db.session.commit()

    return jsonify({
        'message': '下注成功',
        'bet': bet.to_dict(),
        'new_balance': float(user.balance)
    }), 201

@bets_bp.route('/', methods=['GET'])
@jwt_required()
def get_user_bets():
    user_id = int(get_jwt_identity())
    status = request.args.get('status', None)

    query = Bet.query.filter_by(user_id=user_id)

    if status:
        query = query.filter_by(status=status)

    bets = query.order_by(Bet.created_at.desc()).all()
    return jsonify({'bets': [b.to_dict() for b in bets]})

@bets_bp.route('/<int:bet_id>', methods=['GET'])
@jwt_required()
def get_bet(bet_id):
    user_id = int(get_jwt_identity())
    bet = Bet.query.get_or_404(bet_id)

    if bet.user_id != user_id:
        return jsonify({'error': '无权访问'}), 403

    return jsonify({'bet': bet.to_dict()})
