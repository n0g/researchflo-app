import { ref } from 'vue'

const weekStartDay = ref(localStorage.getItem('rb_week_start') || 'monday')
const timeFormat    = ref(localStorage.getItem('rb_time_format') || '12h')

export function useSchedulePrefs() {
  function setWeekStartDay(val) {
    weekStartDay.value = val
    localStorage.setItem('rb_week_start', val)
  }
  function setTimeFormat(val) {
    timeFormat.value = val
    localStorage.setItem('rb_time_format', val)
  }
  return { weekStartDay, timeFormat, setWeekStartDay, setTimeFormat }
}
