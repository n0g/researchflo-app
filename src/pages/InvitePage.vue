<template>
  <f7-page name="invite" class="invite-page">
    <div class="invite-screen">
      <div class="invite-content">
        <div class="invite-logo">researchflo</div>
        <template v-if="claiming">
          <p class="invite-msg">Joining…</p>
        </template>
        <template v-else-if="claimed">
          <p class="invite-msg">You're in! Redirecting…</p>
        </template>
        <template v-else>
          <h1 class="invite-title">You've been invited</h1>
          <p class="invite-msg">Create an account or sign in to collaborate on research projects.</p>
          <button class="btn primary" @click="goToLogin">Sign in / Create account</button>
        </template>
      </div>
    </div>
  </f7-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { f7 } from 'framework7-vue/bundle'
import { useAuthStore } from '../stores/auth.js'
import { useBoardStore } from '../stores/board.js'

const props = defineProps({ token: String })
const authStore = useAuthStore()
const boardStore = useBoardStore()
const claiming = ref(false)
const claimed = ref(false)

onMounted(async () => {
  if (authStore.user && props.token) {
    claiming.value = true
    await boardStore.claimInvite(props.token).catch(console.error)
    claimed.value = true
    claiming.value = false
    setTimeout(() => f7.view.current.router.navigate('/board/'), 1000)
  } else if (props.token) {
    localStorage.setItem('pending_invite_token', props.token)
  }
})

function goToLogin() {
  f7.view.current.router.navigate('/login/')
}
</script>

<style scoped>
.invite-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
}

.invite-content {
  max-width: 360px;
  text-align: center;
}

.invite-logo {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 32px;
  color: var(--accent);
}

.invite-title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 12px;
}

.invite-msg {
  color: var(--text2);
  margin-bottom: 24px;
}
</style>
