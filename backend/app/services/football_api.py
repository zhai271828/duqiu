"""
足球赛程服务

使用 football-data.org 获取赛程。当前实现需要配置 FOOTBALL_DATA_API_KEY。
"""
import requests
from datetime import datetime, timedelta
from flask import current_app


class FootballDataAPI:
    """football-data.org API client."""

    BASE_URL = "https://api.football-data.org/v4"

    def __init__(self):
        self.api_key = current_app.config.get('FOOTBALL_DATA_API_KEY', '').strip()
        self.last_error = None
        self.headers = {
            'User-Agent': 'BettingSimulator/1.0'
        }
        if self.api_key:
            self.headers['X-Auth-Token'] = self.api_key

    def _ensure_configured(self):
        if self.api_key:
            return True

        self.last_error = (
            '未配置 FOOTBALL_DATA_API_KEY，football-data.org 当前接口需要有效的 API Token。'
        )
        current_app.logger.warning(self.last_error)
        return False

    def _request_json(self, url, params=None):
        if not self._ensure_configured():
            return None

        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=10)
        except Exception as e:
            self.last_error = f"请求 football-data.org 失败: {e}"
            current_app.logger.error(self.last_error)
            return None

        if response.status_code == 200:
            self.last_error = None
            return response.json()

        if response.status_code == 403:
            self.last_error = 'football-data.org 返回 403，请检查 FOOTBALL_DATA_API_KEY 是否有效。'
        else:
            self.last_error = f"football-data.org 请求失败: HTTP {response.status_code}"

        current_app.logger.warning(self.last_error)
        return None

    def get_competitions(self):
        """获取可用联赛列表"""
        url = f"{self.BASE_URL}/competitions"
        data = self._request_json(url)
        return data.get('competitions', []) if data else []

    def get_matches(self, competition_id, days=7):
        """获取指定联赛的比赛"""
        url = f"{self.BASE_URL}/competitions/{competition_id}/matches"

        # 获取未来几天的比赛
        today = datetime.utcnow().strftime('%Y-%m-%d')
        end_date = (datetime.utcnow() + timedelta(days=days)).strftime('%Y-%m-%d')

        params = {
            'dateFrom': today,
            'dateTo': end_date,
            'status': 'SCHEDULED,TIMED'  # 只获取未开始的比赛
        }

        data = self._request_json(url, params=params)
        return self._parse_matches(data.get('matches', [])) if data else []

    def _parse_matches(self, matches):
        """解析比赛数据"""
        result = []

        for match in matches:
            try:
                home_team = match.get('homeTeam', {})
                away_team = match.get('awayTeam', {})
                competition = match.get('competition', {})
                area = match.get('area', {})

                # 转换时间
                utc_date = match.get('utcDate', '')
                if utc_date:
                    start_time = datetime.fromisoformat(utc_date.replace('Z', '+00:00'))
                else:
                    continue

                result.append({
                    'external_id': f"fd_{match.get('id')}",
                    'home_team': home_team.get('name', 'Unknown'),
                    'away_team': away_team.get('name', 'Unknown'),
                    'home_team_short': home_team.get('shortName', ''),
                    'away_team_short': away_team.get('shortName', ''),
                    'league': competition.get('name', 'Unknown'),
                    'league_code': competition.get('code', ''),
                    'country': area.get('name', 'Unknown'),
                    'start_time': start_time.isoformat(),
                    'status': self._convert_status(match.get('status', '')),
                    'matchday': match.get('matchday'),
                    'stage': match.get('stage'),
                })
            except Exception as e:
                current_app.logger.error(f"Error parsing match: {e}")
                continue

        return result

    def _convert_status(self, status):
        """转换比赛状态"""
        status_map = {
            'SCHEDULED': 'upcoming',
            'TIMED': 'upcoming',
            'IN_PLAY': 'live',
            'PAUSED': 'live',
            'FINISHED': 'finished',
            'POSTPONED': 'postponed',
            'CANCELLED': 'cancelled',
            'AWARDED': 'finished'
        }
        return status_map.get(status, 'upcoming')

    def get_popular_leagues_matches(self, days=7):
        """获取热门联赛的比赛"""
        if not self._ensure_configured():
            return []

        # 热门联赛 ID（football-data.org）
        popular_leagues = {
            'PL': '英超',
            'PD': '西甲',
            'BL1': '德甲',
            'SA': '意甲',
            'FL1': '法甲',
            'CL': '欧冠',
            'ELC': '英冠',
            'DED': '荷甲',
            'PPL': '葡超',
            'BSA': '巴甲',
        }

        all_matches = []

        for code, name_cn in popular_leagues.items():
            url = f"{self.BASE_URL}/competitions/{code}/matches"
            today = datetime.utcnow().strftime('%Y-%m-%d')
            end_date = (datetime.utcnow() + timedelta(days=days)).strftime('%Y-%m-%d')

            params = {
                'dateFrom': today,
                'dateTo': end_date,
                'status': 'SCHEDULED,TIMED'
            }

            data = self._request_json(url, params=params)
            if not data:
                current_app.logger.warning(f"Failed to fetch {name_cn}: {self.last_error}")
                continue

            matches = self._parse_matches(data.get('matches', []))

            # 添加中文联赛名
            for m in matches:
                m['league_cn'] = name_cn

            all_matches.extend(matches)
            current_app.logger.info(f"Fetched {len(matches)} matches from {name_cn}")

        return all_matches


# 球队名称翻译表（补充常见的）
TEAM_TRANSLATIONS = {
    # 英超
    'Arsenal FC': '阿森纳',
    'Chelsea FC': '切尔西',
    'Liverpool FC': '利物浦',
    'Manchester City FC': '曼城',
    'Manchester United FC': '曼联',
    'Tottenham Hotspur FC': '热刺',
    'Newcastle United FC': '纽卡斯尔',
    'Brighton & Hove Albion FC': '布莱顿',
    'Aston Villa FC': '阿斯顿维拉',
    'West Ham United FC': '西汉姆',
    'Brentford FC': '布伦特福德',
    'Crystal Palace FC': '水晶宫',
    'Fulham FC': '富勒姆',
    'Wolverhampton Wanderers FC': '狼队',
    'AFC Bournemouth': '伯恩茅斯',
    'Nottingham Forest FC': '诺丁汉森林',
    'Everton FC': '埃弗顿',
    'Burnley FC': '伯恩利',
    'Sheffield United FC': '谢菲联',
    'Luton Town FC': '卢顿',

    # 西甲
    'Real Madrid CF': '皇家马德里',
    'FC Barcelona': '巴塞罗那',
    'Club Atlético de Madrid': '马德里竞技',
    'Sevilla FC': '塞维利亚',
    'Real Sociedad de Fútbol': '皇家社会',
    'Athletic Club': '毕尔巴鄂竞技',
    'Villarreal CF': '比利亚雷亚尔',
    'Real Betis Balompié': '皇家贝蒂斯',
    'Valencia CF': '瓦伦西亚',
    'Girona FC': '赫罗纳',

    # 德甲
    'FC Bayern München': '拜仁慕尼黑',
    'Borussia Dortmund': '多特蒙德',
    'Bayer 04 Leverkusen': '勒沃库森',
    'RB Leipzig': '莱比锡',
    'Eintracht Frankfurt': '法兰克福',
    'VfB Stuttgart': '斯图加特',
    'VfL Wolfsburg': '沃尔夫斯堡',
    'Borussia Mönchengladbach': '门兴格拉德巴赫',

    # 意甲
    'FC Internazionale Milano': '国际米兰',
    'AC Milan': 'AC米兰',
    'Juventus FC': '尤文图斯',
    'SSC Napoli': '那不勒斯',
    'AS Roma': '罗马',
    'SS Lazio': '拉齐奥',
    'Atalanta BC': '亚特兰大',
    'ACF Fiorentina': '佛罗伦萨',

    # 法甲
    'Paris Saint-Germain FC': '巴黎圣日耳曼',
    'Olympique de Marseille': '马赛',
    'AS Monaco FC': '摩纳哥',
    'Olympique Lyonnais': '里昂',
    'LOSC Lille': '里尔',
}

def translate_team_name(name):
    """翻译球队名称"""
    return TEAM_TRANSLATIONS.get(name, name)


class OpenLigaDB:
    """OpenLigaDB 完全免费的足球数据 API"""

    BASE_URL = "https://api.openligadb.de"

    # 德甲球队翻译
    BUNDESLIGA_TEAMS = {
        'FC Bayern München': '拜仁慕尼黑',
        'Borussia Dortmund': '多特蒙德',
        'Bayer 04 Leverkusen': '勒沃库森',
        'RB Leipzig': '莱比锡',
        'Eintracht Frankfurt': '法兰克福',
        'VfB Stuttgart': '斯图加特',
        'VfL Wolfsburg': '沃尔夫斯堡',
        'Borussia Mönchengladbach': '门兴格拉德巴赫',
        'SV Werder Bremen': '不莱梅',
        'TSG Hoffenheim': '霍芬海姆',
        'SC Freiburg': '弗赖堡',
        'FC Augsburg': '奥格斯堡',
        '1. FC Heidenheim': '海登海姆',
        'SV Darmstadt 98': '达姆施塔特',
        '1. FC Union Berlin': '柏林联合',
        '1. FSV Mainz 05': '美因茨',
        '1. FC Köln': '科隆',
        'VfL Bochum': '波鸿',
    }

    def get_current_season(self, league='bl1'):
        """获取当前赛季"""
        url = f"{self.BASE_URL}/getavailableleagues"
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                leagues = response.json()
                for l in leagues:
                    if l.get('leagueShortcut') == league:
                        return l.get('leagueSeason')
            return '2025'  # 默认
        except:
            return '2025'

    def get_matches(self, league='bl1', season=None):
        """获取联赛比赛"""
        if not season:
            season = self.get_current_season(league)

        url = f"{self.BASE_URL}/getmatchdata/{league}/{season}"
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                return self._parse_matches(response.json())
            return []
        except Exception as e:
            print(f"OpenLigaDB error: {e}")
            return []

    def get_recent_matches(self, league='bl1', days=7):
        """获取最近几天的比赛"""
        url = f"{self.BASE_URL}/getmatchdata/{league}"
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                matches = response.json()
                return self._parse_matches(matches)
            return []
        except Exception as e:
            print(f"OpenLigaDB error: {e}")
            return []

    def _parse_matches(self, matches):
        """解析比赛数据"""
        result = []

        for match in matches:
            try:
                team1 = match.get('team1', {})
                team2 = match.get('team2', {})

                # 比赛时间
                match_date = match.get('matchDateTime', '')
                if not match_date:
                    continue

                start_time = datetime.fromisoformat(match_date.replace('+01:00', '+00:00').replace('+02:00', '+00:00'))

                # 比分
                match_results = match.get('matchResults', [])
                home_score = None
                away_score = None
                status = 'upcoming'

                if match_results:
                    final_result = match_results[-1]
                    home_score = final_result.get('pointsTeam1')
                    away_score = final_result.get('pointsTeam2')
                    if home_score is not None and away_score is not None:
                        status = 'finished'

                # 翻译队名
                home_name = team1.get('teamName', 'Unknown')
                away_name = team2.get('teamName', 'Unknown')
                home_cn = self.BUNDESLIGA_TEAMS.get(home_name, home_name)
                away_cn = self.BUNDESLIGA_TEAMS.get(away_name, away_name)

                result.append({
                    'external_id': f"openliga_{match.get('matchID')}",
                    'home_team': home_cn,
                    'away_team': away_cn,
                    'home_team_original': home_name,
                    'away_team_original': away_name,
                    'league': '德甲',
                    'start_time': start_time.isoformat(),
                    'status': status,
                    'home_score': home_score,
                    'away_score': away_score,
                    'matchday': match.get('group', {}).get('groupOrderID'),
                })
            except Exception as e:
                continue

        return result
