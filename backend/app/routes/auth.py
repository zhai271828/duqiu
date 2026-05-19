from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import random
import string
from app import db
from app.models.user import User

auth_bp = Blueprint('auth', __name__)

# 存储验证码（生产环境应使用 Redis）
verification_codes = {}


def get_current_user_id():
    """Return the JWT identity as an integer user id."""
    return int(get_jwt_identity())

def generate_verify_code():
    """生成6位验证码"""
    return ''.join(random.choices(string.digits, k=6))

@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()

    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': '请填写所有必填字段'}), 400

    # 检查是否需要邮箱验证
    require_verify = data.get('require_verify', True)
    email_verified = not require_verify

    if require_verify:
        # 验证邮箱验证码
        email = data['email']
        code = data.get('verify_code')

        stored = verification_codes.get(email)
        if not stored:
            return jsonify({'error': '请先获取验证码'}), 400

        if stored['expire'] < datetime.utcnow():
            del verification_codes[email]
            return jsonify({'error': '验证码已过期'}), 400

        # 支持两种注册流程：
        # 1. 先调用 /verify-email，再调用 /register
        # 2. 直接把验证码带到 /register 里完成校验
        if stored.get('verified'):
            email_verified = True
        else:
            if not code:
                return jsonify({'error': '请输入验证码'}), 400
            if stored['code'] != code:
                return jsonify({'error': '验证码错误'}), 400
            email_verified = True

    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': '用户名已存在'}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': '邮箱已注册'}), 400

    user = User(
        username=data['username'],
        email=data['email'],
        email_verified=email_verified
    )
    user.set_password(data['password'])

    db.session.add(user)
    db.session.commit()

    if require_verify:
        verification_codes.pop(data['email'], None)

    access_token = create_access_token(identity=str(user.id))
    return jsonify({
        'message': '注册成功',
        'user': user.to_dict(),
        'access_token': access_token
    }), 201

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()

    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': '请输入用户名和密码'}), 400

    user = User.query.filter_by(username=data['username']).first()

    if not user or not user.check_password(data['password']):
        return jsonify({'error': '用户名或密码错误'}), 401

    access_token = create_access_token(identity=str(user.id))
    return jsonify({
        'message': '登录成功',
        'user': user.to_dict(),
        'access_token': access_token
    })

@auth_bp.route('/profile', methods=['GET'])
@jwt_required()
def profile():
    user_id = get_current_user_id()
    user = User.query.get(user_id)

    if not user:
        return jsonify({'error': '用户不存在'}), 404

    return jsonify({'user': user.to_dict()})

@auth_bp.route('/redeem', methods=['POST'])
@jwt_required()
def redeem():
    user_id = get_current_user_id()
    data = request.get_json()

    if not data or not data.get('code'):
        return jsonify({'error': '请输入兑换码'}), 400

    code = data['code']

    # 兑换码配置
    REDEEM_CODES = {
        'can666': 10000,
        'test888': 5000,
        'vip2024': 20000
    }

    if code not in REDEEM_CODES:
        return jsonify({'error': '无效的兑换码'}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    amount = REDEEM_CODES[code]
    user.balance = float(user.balance) + amount
    db.session.commit()

    return jsonify({
        'message': f'兑换成功！获得 {amount} 虚拟金币',
        'new_balance': float(user.balance)
    })

@auth_bp.route('/send-verify-code', methods=['POST'])
def send_verify_code():
    """发送邮箱验证码"""
    data = request.get_json()

    if not data or not data.get('email'):
        return jsonify({'error': '请输入邮箱'}), 400

    email = data['email']

    # 检查邮箱是否已注册
    if User.query.filter_by(email=email).first():
        return jsonify({'error': '该邮箱已注册'}), 400

    # 生成验证码
    code = generate_verify_code()
    verification_codes[email] = {
        'code': code,
        'expire': datetime.utcnow() + timedelta(minutes=10),
        'verified': False
    }

    # 在实际项目中，这里应该发送邮件
    # 为了测试方便，直接返回验证码
    print(f"\n{'='*50}")
    print(f"邮箱验证码: {email}")
    print(f"验证码: {code}")
    print(f"{'='*50}\n")

    return jsonify({
        'message': '验证码已发送',
        'debug_code': code  # 仅用于测试，生产环境应删除
    })

@auth_bp.route('/verify-email', methods=['POST'])
def verify_email():
    """验证邮箱验证码"""
    data = request.get_json()

    if not data or not data.get('email') or not data.get('code'):
        return jsonify({'error': '请输入邮箱和验证码'}), 400

    email = data['email']
    code = data['code']

    # 检查验证码
    stored = verification_codes.get(email)
    if not stored:
        return jsonify({'error': '请先获取验证码'}), 400

    if stored['expire'] < datetime.utcnow():
        del verification_codes[email]
        return jsonify({'error': '验证码已过期'}), 400

    if stored['code'] != code:
        return jsonify({'error': '验证码错误'}), 400

    # 标记已验证，注册时可直接通过
    stored['verified'] = True

    return jsonify({
        'message': '邮箱验证成功',
        'verified': True
    })
