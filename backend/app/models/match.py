from datetime import datetime
from app import db

class Match(db.Model):
    __tablename__ = 'matches'

    id = db.Column(db.Integer, primary_key=True)
    external_id = db.Column(db.String(100), unique=True, nullable=True)
    sport = db.Column(db.String(50), nullable=False)
    league = db.Column(db.String(100), nullable=False)
    home_team = db.Column(db.String(100), nullable=False)
    away_team = db.Column(db.String(100), nullable=False)
    start_time = db.Column(db.DateTime, nullable=False)
    status = db.Column(db.String(20), default='upcoming')
    home_score = db.Column(db.Integer, nullable=True)
    away_score = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    odds = db.relationship('Odds', backref='match', lazy=True, cascade='all, delete-orphan')
    bets = db.relationship('Bet', backref='match', lazy=True)

    def _to_utc_iso(self, dt):
        """将 datetime 转为 UTC ISO 字符串（带 +00:00），确保前端能正确解析"""
        if dt is None:
            return None
        # SQLite 返回的 naive datetime 视为 UTC
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt.isoformat() + '+00:00'

    def to_dict(self, include_odds=True):
        odds_list = [odd.to_dict() for odd in self.odds] if include_odds else []
        avg_odds = self._calculate_avg_odds()

        return {
            'id': self.id,
            'external_id': self.external_id,
            'sport': self.sport,
            'league': self.league,
            'home_team': self.home_team,
            'away_team': self.away_team,
            'start_time': self._to_utc_iso(self.start_time),
            'status': self.status,
            'home_score': self.home_score,
            'away_score': self.away_score,
            'odds': odds_list,
            'avg_odds': avg_odds,
            'odds_count': len(self.odds)
        }

    def _calculate_avg_odds(self):
        """计算平均赔率"""
        if not self.odds:
            return None

        home_odds = [float(o.home_odds) for o in self.odds if o.home_odds is not None]
        draw_odds = [float(o.draw_odds) for o in self.odds if o.draw_odds is not None]
        away_odds = [float(o.away_odds) for o in self.odds if o.away_odds is not None]

        avg = {}
        if home_odds:
            avg['home'] = round(sum(home_odds) / len(home_odds), 2)
        if draw_odds:
            avg['draw'] = round(sum(draw_odds) / len(draw_odds), 2)
        if away_odds:
            avg['away'] = round(sum(away_odds) / len(away_odds), 2)

        return avg if avg else None

class Odds(db.Model):
    __tablename__ = 'odds'

    id = db.Column(db.Integer, primary_key=True)
    match_id = db.Column(db.Integer, db.ForeignKey('matches.id'), nullable=False)
    bookmaker = db.Column(db.String(50), nullable=False)
    market = db.Column(db.String(50), nullable=False)
    home_odds = db.Column(db.Numeric(8, 2), nullable=True)
    away_odds = db.Column(db.Numeric(8, 2), nullable=True)
    draw_odds = db.Column(db.Numeric(8, 2), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        updated = self.updated_at
        if updated and updated.tzinfo is not None:
            updated = updated.replace(tzinfo=None)
        updated_str = updated.isoformat() + '+00:00' if updated else None

        return {
            'id': self.id,
            'bookmaker': self.bookmaker,
            'market': self.market,
            'home_odds': float(self.home_odds) if self.home_odds else None,
            'away_odds': float(self.away_odds) if self.away_odds else None,
            'draw_odds': float(self.draw_odds) if self.draw_odds else None,
            'updated_at': updated_str
        }
