
const parseDate = (s) => {
    const d = new Date()
    d.setSeconds(0, 0)
    if (!s) return d
    const [dPart, tPart] = s.split(' ')
    if (dPart && tPart) {
      const yr = d.getFullYear()
      const [mm, dd] = dPart.split('-').map(Number)
      const [hh, min] = tPart.split(':').map(Number)
      return new Date(yr, mm - 1, dd, hh, min)
    }
    return d
}

function getDuration(start, stop) {
  const startD = parseDate(start)
  const stopD = parseDate(stop)
  let diffMins = Math.round((stopD.getTime() - startD.getTime()) / 60000)
  if (diffMins < 0) diffMins += 1440
  return { h: Math.floor(diffMins / 60), m: diffMins % 60 }
}

function buildStopByDuration(schedStart, durH, durM) {
  let baseDate = new Date()
  baseDate.setSeconds(0, 0)
  const [dPart, tPart] = schedStart.split(' ')
  if (dPart && tPart) {
    const yr = baseDate.getFullYear()
    const [mm, dd] = dPart.split('-').map(Number)
    const [hh, min] = tPart.split(':').map(Number)
    baseDate = new Date(yr, mm - 1, dd, hh, min)
  }
  baseDate.setMinutes(baseDate.getMinutes() + durH * 60 + durM)
  const fMonth = String(baseDate.getMonth() + 1).padStart(2, '0')
  const fDate = String(baseDate.getDate()).padStart(2, '0')
  const fH = String(baseDate.getHours()).padStart(2, '0')
  const fM = String(baseDate.getMinutes()).padStart(2, '0')
  return \\-\ \:\\
}

const start = '04-15 12:00'
const stop1 = buildStopByDuration(start, 11, 45)
console.log('stop string:', stop1)
console.log('duration:', getDuration(start, stop1))

