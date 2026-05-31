import LoginPage from './pages/LoginPage.vue'
import BoardPage from './pages/BoardPage.vue'
import ProjectDetailPage from './pages/ProjectDetailPage.vue'
import NewProjectPage from './pages/NewProjectPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import InboxPage from './pages/InboxPage.vue'
import SchedulePage from './pages/SchedulePage.vue'
import SchedulePlacePage from './pages/SchedulePlacePage.vue'
import InvitePage from './pages/InvitePage.vue'

export default [
  { path: '/', component: LoginPage },
  { path: '/login/', component: LoginPage },
  { path: '/board/', component: BoardPage },
  { path: '/project/new/', component: NewProjectPage },
  { path: '/project/:id/', component: ProjectDetailPage },
  { path: '/inbox/', component: InboxPage },
  { path: '/schedule/', component: SchedulePage },
  { path: '/schedule/place/', component: SchedulePlacePage },
  { path: '/settings/', component: SettingsPage },
  { path: '/invite/:token/', component: InvitePage, props: true },
]
