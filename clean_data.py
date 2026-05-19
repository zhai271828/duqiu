"""清理数据库，只保留有真实赔率的比赛"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app import create_app, db
from app.models.match import Match, Odds

app = create_app('development')

with app.app_context():
    # 删除没有赔率的比赛（模拟数据）
    matches = Match.query.all()
    deleted = 0

    for match in matches:
        if not match.odds or len(match.odds) == 0:
            print(f"Deleting: {match.home_team} vs {match.away_team} (no odds)")
            db.session.delete(match)
            deleted += 1

    db.session.commit()
    print(f"\nDeleted {deleted} matches without odds")

    # 显示剩余比赛
    remaining = Match.query.all()
    print(f"\nRemaining matches: {len(remaining)}")
    for m in remaining:
        print(f"  - {m.home_team} vs {m.away_team} ({m.league}) - {len(m.odds)} odds")
