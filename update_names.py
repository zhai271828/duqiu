import sys
sys.path.insert(0, 'backend')

from app import create_app, db
from app.models.match import Match
from app.services.odds_service import translate_team, translate_league

app = create_app('development')

with app.app_context():
    matches = Match.query.all()
    updated = 0

    for match in matches:
        # 翻译球队名称
        new_home = translate_team(match.home_team)
        new_away = translate_team(match.away_team)
        new_league = translate_league(match.league)

        if (new_home != match.home_team or
            new_away != match.away_team or
            new_league != match.league):
            match.home_team = new_home
            match.away_team = new_away
            match.league = new_league
            updated += 1
            print(f"Updated: {match.home_team} vs {match.away_team} ({match.league})")

    db.session.commit()
    print(f"\nTotal updated: {updated} matches")

    # 显示更新后的数据
    print("\nCurrent matches:")
    for match in Match.query.all():
        print(f"  {match.home_team} vs {match.away_team} - {match.league}")
