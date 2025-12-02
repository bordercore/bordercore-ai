<!-- ./src/components/ModelSelect.vue -->
<script setup>
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

const props = defineProps({
    modelValue: {
        type: String,
        default: "",
    },
    modelList: {
        type: Array,
        required: true,
    },
    getModelIcon: {
        type: Function,
        required: true,
    },
});

const emit = defineEmits(["update:modelValue", "change"]);

const isOpen = ref(false);

const selectedModel = computed(() => {
    return props.modelList.find((m) => m.model === props.modelValue) || null;
});

const selectedModelName = computed(() => {
    return selectedModel.value ? selectedModel.value.name : "Select a model";
});

const selectedModelIcon = computed(() => {
    return selectedModel.value ? props.getModelIcon(selectedModel.value) : "";
});

function selectModel(model) {
    emit("update:modelValue", model.model);
    // Create event object compatible with handleChangeModel which expects event.srcElement.value
    const event = {
        target: { value: model.model },
        srcElement: { value: model.model },
    };
    emit("change", event);
    isOpen.value = false;
}

function handleKeydown(event, model) {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectModel(model);
    } else if (event.key === "Escape") {
        isOpen.value = false;
    }
}

// Setup hover listeners for dropdown items
function setupHoverListeners() {
    nextTick(() => {
        const menu = document.querySelector('.model-dropdown-menu');
        if (!menu) return;
        
        const items = menu.querySelectorAll('.o-dropdown__item, [role="option"]');
        items.forEach(item => {
            // Set default white color
            item.style.setProperty('color', '#fff', 'important');
            const allChildren = item.querySelectorAll('*');
            allChildren.forEach(child => {
                child.style.setProperty('color', '#fff', 'important');
            });
            
            // Mouse enter - set dark purple
            item.addEventListener('mouseenter', function() {
                this.style.setProperty('color', '#3c1679', 'important');
                const children = this.querySelectorAll('*');
                children.forEach(child => {
                    child.style.setProperty('color', '#3c1679', 'important');
                });
            });
            
            // Mouse leave - set back to white
            item.addEventListener('mouseleave', function() {
                this.style.setProperty('color', '#fff', 'important');
                const children = this.querySelectorAll('*');
                children.forEach(child => {
                    child.style.setProperty('color', '#fff', 'important');
                });
            });
        });
    });
}

// Watch for dropdown opening
watch(isOpen, (newVal) => {
    if (newVal) {
        setupHoverListeners();
        // Retry multiple times to catch delayed rendering
        setTimeout(setupHoverListeners, 10);
        setTimeout(setupHoverListeners, 50);
        setTimeout(setupHoverListeners, 100);
    }
});

let observer = null;

onMounted(() => {
    // Setup listeners when component mounts
    setupHoverListeners();
    
    // Watch for dropdown menu being added to DOM
    const wrapper = document.querySelector('.model-select-wrapper');
    if (wrapper) {
        observer = new MutationObserver(() => {
            setupHoverListeners();
        });
        
        observer.observe(wrapper, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }
});

onBeforeUnmount(() => {
    if (observer) {
        observer.disconnect();
    }
});
</script>

<template>
    <div class="model-select-wrapper">
        <o-dropdown 
            v-model="isOpen" 
            position="bottom-left" 
            aria-role="list" 
            :expanded="true"
            menu-class="model-dropdown-menu"
        >
            <template #trigger>
                <button
                    class="model-select-trigger form-select"
                    type="button"
                    :aria-expanded="isOpen"
                    aria-haspopup="listbox"
                >
                    <span class="model-select-content">
                        <span class="model-select-name">{{ selectedModelName }}</span>
                        <span v-if="selectedModelIcon" class="model-select-icon">
                            <font-awesome-icon
                                v-if="selectedModelIcon.startsWith('fa-')"
                                :icon="selectedModelIcon.replace('fa-', '')"
                                class="fa-icon"
                            />
                            <span v-else class="emoji-icon">{{ selectedModelIcon }}</span>
                        </span>
                    </span>
                    <span class="model-select-arrow">▼</span>
                </button>
            </template>

            <o-dropdown-item
                v-for="model in modelList"
                :key="model.model"
                :value="model.model"
                :class="{ 'is-active': model.model === modelValue }"
                @click="selectModel(model)"
                @keydown="handleKeydown($event, model)"
                role="option"
                :aria-selected="model.model === modelValue"
            >
                <div class="model-option-content">
                    <span class="model-option-name">{{ model.name }}</span>
                    <span v-if="getModelIcon(model)" class="model-option-icon">
                        <font-awesome-icon
                            v-if="getModelIcon(model).startsWith('fa-')"
                            :icon="getModelIcon(model).replace('fa-', '')"
                            class="fa-icon"
                        />
                        <span v-else class="emoji-icon">{{ getModelIcon(model) }}</span>
                    </span>
                </div>
            </o-dropdown-item>
        </o-dropdown>
    </div>
</template>

<style scoped>
.model-select-wrapper {
    position: relative;
    width: 100%;
    min-width: 0;
}

.model-select-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.375rem 0.75rem;
    background-color: #3c1679 !important;
    color: #fff !important;
    border: 1px solid #ced4da;
    border-radius: 0.375rem;
    cursor: pointer;
    text-align: left;
}

.model-select-trigger:hover {
    border-color: #86b7fe;
}

.model-select-trigger:focus {
    outline: 0;
    border-color: #86b7fe;
    box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.25);
}

.model-select-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    flex: 1;
    min-width: 0;
}

.model-select-name {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.model-select-icon {
    margin-left: 0.5rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
}

.model-select-arrow {
    margin-left: 0.5rem;
    flex-shrink: 0;
    font-size: 0.75rem;
    opacity: 0.7;
}

.model-option-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 0.5rem;
}

.model-option-name {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.model-option-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    margin-left: auto;
}

.fa-icon {
    font-size: 1rem;
}

.emoji-icon {
    font-size: 1rem;
    line-height: 1;
}

/* Base override for Oruga dropdown */
:deep(.o-dropdown) {
    width: 100%;
    display: block;
}
</style>

<style>
/* Global unscoped styles for the dropdown menu */
/* Targeted via menu-class="model-dropdown-menu" prop on o-dropdown */

.model-dropdown-menu {
    background-color: #0d0926 !important;
    border: 1px solid #ced4da;
    border-radius: 0.375rem;
    max-height: 300px;
    overflow-y: auto;
    
    /* Layout overrides */
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box;
    position: absolute;
    left: 0 !important;
    right: auto !important;
    transform: none !important;
}

/* Base text color (white) for all items and children NOT being hovered */
.model-dropdown-menu .o-dropdown__item:not(:hover),
.model-dropdown-menu .o-dropdown__item:not(:hover) * {
    color: #fff !important;
}

/* Hover state: Dark purple text ONLY for the hovered item and its children */
.model-dropdown-menu .o-dropdown__item:hover,
.model-dropdown-menu .o-dropdown__item:hover * {
    background-color: rgba(255, 255, 255, 0.1) !important;
    color: #3c1679 !important;
}

/* Active/Selected state background */
.model-dropdown-menu .o-dropdown__item.is-active {
    background-color: rgba(13, 110, 253, 0.3) !important;
}

/* Active state hover - ensure text remains dark purple if hovered */
.model-dropdown-menu .o-dropdown__item.is-active:hover,
.model-dropdown-menu .o-dropdown__item.is-active:hover * {
    color: #3c1679 !important;
}
</style>
