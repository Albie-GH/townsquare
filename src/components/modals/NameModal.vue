<template>
  <!-- "Enter player name": asked when you join voice (or take a seat without a name).
       It can't be closed: you have to enter a name and accept. -->
  <Modal class="name-modal" v-if="namePrompt.open" :closable="false">
    <h3>Enter player name</h3>
    <form @submit.prevent="submit">
      <input
        ref="input"
        v-model="value"
        maxlength="30"
        placeholder="Your name"
        @keyup.stop
      />
      <div class="buttons">
        <button type="submit" class="button townsfolk" :class="{ disabled: !clean }">
          OK
        </button>
      </div>
    </form>
  </Modal>
</template>

<script>
import Modal from "./Modal";
import { namePrompt, answerName } from "../../namePrompt";

export default {
  components: { Modal },
  data() {
    return { namePrompt, value: "" };
  },
  computed: {
    clean() {
      return this.value.trim().slice(0, 30);
    }
  },
  watch: {
    // start from the name you used last time, with the cursor in the box
    "namePrompt.open"(open) {
      if (!open) return;
      this.value = namePrompt.initial || "";
      this.$nextTick(() => {
        if (this.$refs.input) {
          this.$refs.input.focus();
          this.$refs.input.select();
        }
      });
    }
  },
  methods: {
    submit() {
      if (!this.clean) return;
      answerName(this.clean);
    },
    // Enter submits through the form; keys typed here never reach the hotkeys
  }
};
</script>

<style lang="scss" scoped>
h3 {
  margin: 0 10px 10px;
}

form {
  display: flex;
  flex-direction: column;
  align-items: center;
}

input {
  background: transparent;
  color: white;
  font-family: inherit;
  font-size: 120%;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 5px;
  padding: 6px 10px;
  width: 260px;
  max-width: 100%;
  outline: none;
  &:focus {
    border-color: rgba(255, 255, 255, 0.8);
  }
}

.buttons {
  margin-top: 10px;
  button {
    font-family: inherit;
    font-size: 100%;
    padding: 0 10px;
  }
}
</style>
