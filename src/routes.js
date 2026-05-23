import LoginPage from './pages/LoginPage.vue'
import BoardPage from './pages/BoardPage.vue'
import ReviewsPage from './pages/ReviewsPage.vue'
import HotCRPPage from './pages/HotCRPPage.vue'
import ProjectDetailPage from './pages/ProjectDetailPage.vue'
import NewProjectPage from './pages/NewProjectPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import InboxPage from './pages/InboxPage.vue'
import TaskDetailPage from './pages/TaskDetailPage.vue'
import SchedulePage from './pages/SchedulePage.vue'
import SchedulePlacePage from './pages/SchedulePlacePage.vue'

export default [
  { path: '/', component: LoginPage },
  { path: '/login/', component: LoginPage },
  { path: '/board/', component: BoardPage },
  { path: '/reviews/', component: ReviewsPage },
  { path: '/hotcrp/', component: HotCRPPage },
  { path: '/project/new/', component: NewProjectPage },
  { path: '/project/:id/', component: ProjectDetailPage },
  { path: '/inbox/', component: InboxPage },
  { path: '/tasks/:id/', component: TaskDetailPage },
  { path: '/schedule/', component: SchedulePage },
  { path: '/schedule/place/', component: SchedulePlacePage },
  { path: '/settings/', component: SettingsPage },
]
