import requests
from datetime import datetime, timedelta
from flask import current_app
from app import db
from app.models.match import Match, Odds

# 球队名称中英文映射
TEAM_NAME_MAP = {
    # A-League
    'Adelaide United': '阿德莱德联',
    'Auckland FC': '奥克兰FC',
    'Melbourne Victory': '墨尔本胜利',
    'Sydney FC': '悉尼FC',
    'Western Sydney Wanderers': '西悉尼流浪者',
    'Brisbane Roar': '布里斯班狮吼',
    'Central Coast Mariners': '中央海岸水手',
    'Melbourne City': '墨尔本城',
    'Newcastle Jets': '纽卡斯尔喷气机',
    'Perth Glory': '珀斯光荣',
    'Wellington Phoenix': '惠灵顿凤凰',

    # Premier League
    'Arsenal': '阿森纳',
    'Aston Villa': '阿斯顿维拉',
    'Bournemouth': '伯恩茅斯',
    'Brentford': '布伦特福德',
    'Brighton': '布莱顿',
    'Brighton & Hove Albion': '布莱顿',
    'Chelsea': '切尔西',
    'Crystal Palace': '水晶宫',
    'Everton': '埃弗顿',
    'Fulham': '富勒姆',
    'Ipswich Town': '伊普斯维奇',
    'Leicester City': '莱斯特城',
    'Liverpool': '利物浦',
    'Manchester City': '曼城',
    'Manchester United': '曼联',
    'Newcastle United': '纽卡斯尔',
    'Nottingham Forest': '诺丁汉森林',
    'Southampton': '南安普顿',
    'Tottenham': '热刺',
    'Tottenham Hotspur': '热刺',
    'West Ham': '西汉姆',
    'West Ham United': '西汉姆',
    'Wolverhampton Wanderers': '狼队',
    'Wolves': '狼队',

    # La Liga
    'Atletico Madrid': '马德里竞技',
    'Barcelona': '巴塞罗那',
    'Real Madrid': '皇家马德里',
    'Sevilla': '塞维利亚',
    'Valencia': '瓦伦西亚',
    'Villarreal': '比利亚雷亚尔',
    'Real Sociedad': '皇家社会',
    'Athletic Bilbao': '毕尔巴鄂竞技',
    'Real Betis': '皇家贝蒂斯',
    'Girona': '赫罗纳',

    # Bundesliga
    'Bayern Munich': '拜仁慕尼黑',
    'Borussia Dortmund': '多特蒙德',
    'RB Leipzig': '莱比锡',
    'Bayer Leverkusen': '勒沃库森',
    'Eintracht Frankfurt': '法兰克福',
    'Stuttgart': '斯图加特',
    'Wolfsburg': '沃尔夫斯堡',
    'Borussia Monchengladbach': '门兴格拉德巴赫',

    # Serie A
    'AC Milan': 'AC米兰',
    'Inter Milan': '国际米兰',
    'Juventus': '尤文图斯',
    'Napoli': '那不勒斯',
    'Roma': '罗马',
    'Lazio': '拉齐奥',
    'Atalanta': '亚特兰大',
    'Fiorentina': '佛罗伦萨',

    # Ligue 1
    'Paris Saint-Germain': '巴黎圣日耳曼',
    'Marseille': '马赛',
    'Monaco': '摩纳哥',
    'Lyon': '里昂',
    'Lille': '里尔',

    # Champions League common teams
    'Ajax': '阿贾克斯',
    'Benfica': '本菲卡',
    'Porto': '波尔图',
    'Sporting CP': '葡萄牙体育',
    'Celtic': '凯尔特人',
    'Rangers': '流浪者',
    'Galatasaray': '加拉塔萨雷',
    'Fenerbahce': '费内巴切',
    'Shakhtar Donetsk': '顿涅茨克矿工',
    'Red Star Belgrade': '贝尔格莱德红星',
    'Salzburg': '萨尔茨堡',
    'Dinamo Zagreb': '萨格勒布迪纳摩',

    # 中超
    'Shanghai SIPG FC': '上海海港',
    'Shanghai Port': '上海海港',
    'Beijing FC': '北京国安',
    'Beijing Guoan': '北京国安',
    'Guangzhou FC': '广州队',
    'Guangzhou Evergrande': '广州恒大',
    'Shandong Taishan': '山东泰山',
    'Shandong Luneng': '山东鲁能',
    'Tianjin Jinmen Tiger FC': '天津津门虎',
    'Tianjin Teda': '天津泰达',
    'Chengdu Rongcheng FC': '成都蓉城',
    'Henan FC': '河南嵩山龙门',
    'Henan Songshan Longmen': '河南嵩山龙门',
    'Shenzhen Peng City FC': '深圳新鹏城',
    'Shenzhen FC': '深圳队',
    'Zhejiang': '浙江队',
    'Zhejiang Professional': '浙江队',
    'Dalian Yingbo': '大连英博',
    'Dalian Pro': '大连人',
    'Qingdao Hainiu FC': '青岛海牛',
    'Qingdao West Coast FC': '青岛西海岸',
    'Wuhan Three Towns': '武汉三镇',
    'Wuhan FC': '武汉队',
    'Changchun Yatai': '长春亚泰',
    'Meizhou Hakka': '梅州客家',
    'Nantong Zhiyun': '南通支云',
    'Cangzhou Mighty Lions': '沧州雄狮',

    # J联赛
    'Kawasaki Frontale': '川崎前锋',
    'Yokohama F. Marinos': '横滨水手',
    'Urawa Red Diamonds': '浦和红钻',
    'Kashima Antlers': '鹿岛鹿角',
    'FC Tokyo': 'FC东京',
    'Cerezo Osaka': '大阪樱花',
    'Gamba Osaka': '大阪钢巴',
    'Nagoya Grampus': '名古屋鲸八',
    'Vissel Kobe': '神户胜利船',

    # K联赛
    'Jeonbuk Hyundai Motors': '全北现代',
    'Ulsan Hyundai': '蔚山现代',
    'FC Seoul': 'FC首尔',
    'Suwon Samsung Bluewings': '水原三星',
    'Pohang Steelers': '浦项制铁',
}

# 联赛名称翻译
LEAGUE_NAME_MAP = {
    'A-League': '澳超',
    'Premier League': '英超',
    'English Premier League': '英超',
    'La Liga': '西甲',
    'Spanish La Liga': '西甲',
    'Bundesliga': '德甲',
    'German Bundesliga': '德甲',
    'Serie A': '意甲',
    'Italian Serie A': '意甲',
    'Ligue 1': '法甲',
    'French Ligue 1': '法甲',
    'Champions League': '欧冠',
    'UEFA Champions League': '欧冠',
    'Europa League': '欧联',
    'UEFA Europa League': '欧联',
    'Conference League': '欧会杯',
    'FA Cup': '足总杯',
    'Copa del Rey': '国王杯',
    'DFB Pokal': '德国杯',
    'Coppa Italia': '意大利杯',
    'Coupe de France': '法国杯',
    'League Cup': '联赛杯',
    'EFL Championship': '英冠',
    'Serie B': '意乙',
    'La Liga 2': '西乙',
    '2. Bundesliga': '德乙',
    'Ligue 2': '法乙',
    'MLS': '美职联',
    'Saudi Pro League': '沙特联赛',
    'Super Lig': '土超',
    'Eredivisie': '荷甲',
    'Primeira Liga': '葡超',
    'Scottish Premiership': '苏超',
    'Brasileirao': '巴甲',
    'Argentine Primera': '阿甲',
    'J-League': 'J联赛',
    'K-League': 'K联赛',
    'Chinese Super League': '中超',
    'Super League - China': '中超',
    'J1 League': 'J联赛',
    'K League 1': 'K联赛',
}

def translate_team(name):
    """翻译球队名称"""
    return TEAM_NAME_MAP.get(name, name)

def translate_league(name):
    """翻译联赛名称"""
    return LEAGUE_NAME_MAP.get(name, name)

class OddsService:
    def __init__(self):
        self.api_key = current_app.config.get('ODDS_API_KEY', '')
        self.base_url = current_app.config.get('ODDS_API_BASE_URL', 'https://api.the-odds-api.com/v4')

    def fetch_odds(self, sport='soccer', regions='eu', markets='h2h'):
        """从 API 获取赔率数据"""
        if not self.api_key:
            current_app.logger.warning("ODDS_API_KEY not configured, skipping odds fetch")
            return None, 0

        url = f"{self.base_url}/sports/{sport}/odds"
        params = {
            'apiKey': self.api_key,
            'regions': regions,
            'markets': markets,
            'oddsFormat': 'decimal'
        }

        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()

            # 记录剩余请求次数
            remaining = response.headers.get('x-requests-remaining', 'unknown')
            current_app.logger.info(f"API requests remaining: {remaining}")

            return response.json(), remaining
        except requests.RequestException as e:
            current_app.logger.error(f"Failed to fetch odds: {e}")
            return None, 0

    def should_update(self, match):
        """检查是否需要更新赔率（缓存策略）"""
        if not match.odds:
            return True

        # 获取最新赔率更新时间
        latest_update = max([o.updated_at for o in match.odds]) if match.odds else None

        if not latest_update:
            return True

        # 比赛开始前 1 小时内，每 10 分钟更新
        if match.start_time - datetime.utcnow() < timedelta(hours=1):
            return datetime.utcnow() - latest_update > timedelta(minutes=10)

        # 其他情况，每 2 小时更新一次
        return datetime.utcnow() - latest_update > timedelta(hours=2)

    def sync_upcoming_matches(self, force=False):
        """同步即将开始的比赛和赔率"""
        if not self.api_key:
            return {
                'error': '未配置 ODDS_API_KEY，请在 backend/.env 中填入 API Key。'
                         '免费获取：https://the-odds-api.com',
                'synced': 0
            }

        data, remaining = self.fetch_odds()

        if not data:
            return {'error': '获取赔率数据失败，请检查 API Key 是否有效', 'synced': 0}

        synced_count = 0
        skipped_count = 0

        for event in data:
            external_id = event.get('id')
            home_team = event.get('home_team')
            away_team = event.get('away_team')
            commence_time = datetime.fromisoformat(event.get('commence_time').replace('Z', '+00:00'))
            league = event.get('sport_title', 'Unknown')

            # 翻译球队和联赛名称
            home_team_cn = translate_team(home_team)
            away_team_cn = translate_team(away_team)
            league_cn = translate_league(league)

            match = Match.query.filter_by(external_id=external_id).first()

            if not match:
                match = Match(
                    external_id=external_id,
                    sport='soccer',
                    league=league_cn,
                    home_team=home_team_cn,
                    away_team=away_team_cn,
                    start_time=commence_time,
                    status='upcoming'
                )
                db.session.add(match)
                db.session.flush()
            else:
                # 更新已有比赛信息
                match.home_team = home_team_cn
                match.away_team = away_team_cn
                match.league = league_cn

            # 检查是否需要更新赔率
            if not force and not self.should_update(match):
                skipped_count += 1
                continue

            # 更新赔率
            for bookmaker in event.get('bookmakers', []):
                bookmaker_name = bookmaker.get('title')

                for market in bookmaker.get('markets', []):
                    market_key = market.get('key')
                    outcomes = market.get('outcomes', [])

                    home_odds = None
                    away_odds = None
                    draw_odds = None

                    for outcome in outcomes:
                        if outcome.get('name') == home_team:
                            home_odds = outcome.get('price')
                        elif outcome.get('name') == away_team:
                            away_odds = outcome.get('price')
                        elif outcome.get('name') == 'Draw':
                            draw_odds = outcome.get('price')

                    existing_odds = Odds.query.filter_by(
                        match_id=match.id,
                        bookmaker=bookmaker_name,
                        market=market_key
                    ).first()

                    if existing_odds:
                        existing_odds.home_odds = home_odds
                        existing_odds.away_odds = away_odds
                        existing_odds.draw_odds = draw_odds
                        existing_odds.updated_at = datetime.utcnow()
                    else:
                        new_odds = Odds(
                            match_id=match.id,
                            bookmaker=bookmaker_name,
                            market=market_key,
                            home_odds=home_odds,
                            away_odds=away_odds,
                            draw_odds=draw_odds
                        )
                        db.session.add(new_odds)

            synced_count += 1

        db.session.commit()

        return {
            'message': f'同步完成：{synced_count} 场更新，{skipped_count} 场跳过（缓存中）',
            'synced': synced_count,
            'skipped': skipped_count,
            'api_remaining': remaining
        }
