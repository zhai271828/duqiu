from datetime import datetime
from app import db

class Bet(db.Model):
    __tablename__ = 'bets'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    match_id = db.Column(db.Integer, db.ForeignKey('matches.id'), nullable=False)
    bet_type = db.Column(db.String(50), nullable=False)
    selection = db.Column(db.String(50), nullable=False)
    odds = db.Column(db.Numeric(8, 2), nullable=False)
    amount = db.Column(db.Numeric(12, 2), nullable=False)
    potential_win = db.Column(db.Numeric(12, 2), nullable=False)
    status = db.Column(db.String(20), default='pending')
    profit = db.Column(db.Numeric(12, 2), nullable=True)
    settled_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    @staticmethod
    def _utc_iso(dt):
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt.isoformat() + '+00:00'

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'match_id': self.match_id,
            'bet_type': self.bet_type,
            'selection': self.selection,
            'odds': float(self.odds),
            'amount': float(self.amount),
            'potential_win': float(self.potential_win),
            'status': self.status,
            'profit': float(self.profit) if self.profit else None,
            'settled_at': self._utc_iso(self.settled_at),
            'created_at': self._utc_iso(self.created_at),
            'match': {
                'home_team': self.match.home_team,
                'away_team': self.match.away_team,
                'league': self.match.league,
                'start_time': self._utc_iso(self.match.start_time)
            } if self.match else None
        }
