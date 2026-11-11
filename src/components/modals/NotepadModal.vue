<template>
  <Modal class="notepad" v-if="modals.notepad" @close="toggleModal('notepad')">
    <h3>Notepad</h3>
    <textarea
      ref="text"
      v-model="text"
      placeholder="Your private notes. Only you can see these."
      @keyup.stop="onKey"
    ></textarea>
  </Modal>
</template>

<script>
import Modal from "./Modal";
import { mapMutations, mapState } from "vuex";

// saved in this browser only, so every player has their own notes
const NOTEPAD_KEY = "notepad";

function loadNotes() {
  try {
    return localStorage.getItem(NOTEPAD_KEY) || "";
  } catch (e) {
    return "";
  }
}

export default {
  components: {
    Modal
  },
  data() {
    return {
      text: loadNotes()
    };
  },
  computed: {
    ...mapState(["modals"])
  },
  watch: {
    text(value) {
      try {
        localStorage.setItem(NOTEPAD_KEY, value);
      } catch (e) {
        // storage unavailable, notes last until the page is closed
      }
    },
    // put the cursor straight in the box when it opens
    "modals.notepad"(open) {
      if (open) this.$nextTick(() => this.$refs.text && this.$refs.text.focus());
    }
  },
  methods: {
    ...mapMutations(["toggleModal"]),
    // typing doesn't trigger shortcuts, but Esc still closes the notepad
    onKey(event) {
      if (event.key === "Escape") this.toggleModal("notepad");
    }
  }
};
</script>

<style lang="scss" scoped>
@import "../../vars.scss";

h3 {
  margin: 0 40px 5px;
}

textarea {
  background: transparent;
  color: white;
  font-family: inherit;
  font-size: 100%;
  line-height: 1.4;
  white-space: pre-wrap;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 5px;
  padding: 8px;
  width: 50vw;
  height: 50vh;
  max-width: 100%;
  margin: 5px 0;
  resize: none;
  outline: none;
  &:focus {
    border-color: rgba(255, 255, 255, 0.8);
  }
}

.maximized textarea {
  width: 90vw;
  height: 85vh;
}
</style>
