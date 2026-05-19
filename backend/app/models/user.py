from datetime import datetime
from app import db
import bcrypt

class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)
    email = db.Column(db.String(100), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    balance = db.Column(db.Numeric(12, 2), default=10000.00)
    email_verified = db.Column(db.Boolean, default=False)
    verify_code = db.Column(db.String(6), nullable=True)
    verify_code_expire = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    bets = db.relationship('Bet', backref='user', lazy=True)

    def set_password(self, password):
        self.password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    def check_password(self, password):
        return bcrypt.checkpw(password.encode('utf-8'), self.password_hash.encode('utf-8'))

    def to_dict(self):
        created = self.created_at
        if created and created.tzinfo is not None:
            created = created.replace(tzinfo=None)
        created_str = created.isoformat() + '+00:00' if created else None

        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'balance': float(self.balance),
            'created_at': created_str
        }
