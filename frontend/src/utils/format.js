export const formatTime = (timeString) => {
  if (!timeString) return ''
  const date = new Date(timeString)
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

export const formatMoney = (amount) => {
  if (amount === null || amount === undefined) return '0.00'
  return Number(amount).toFixed(2)
}

export const formatPercentage = (value) => {
  if (value === null || value === undefined) return '0%'
  return `${Number(value).toFixed(2)}%`
}

export const getMatchSideLabels = (match) => {
  if (match?.side_labels?.home && match?.side_labels?.away) {
    return match.side_labels
  }

  const hasHomeAway = !(match?.has_home_away === false || match?.has_home_away === 0)
  return hasHomeAway
    ? { home: '主队', away: '客队' }
    : { home: '队伍A', away: '队伍B' }
}

export const getMatchSelectionTexts = (match) => {
  if (match?.selection_texts?.home && match?.selection_texts?.away) {
    return {
      home: match.selection_texts.home,
      draw: match.selection_texts.draw || '平局',
      away: match.selection_texts.away
    }
  }

  const hasHomeAway = !(match?.has_home_away === false || match?.has_home_away === 0)
  if (hasHomeAway) {
    return { home: '主胜', draw: '平局', away: '客胜' }
  }

  return {
    home: `${match?.home_team || '队伍A'} 胜`,
    draw: '平局',
    away: `${match?.away_team || '队伍B'} 胜`
  }
}
