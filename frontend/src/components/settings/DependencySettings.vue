<template>
  <div class="dependency-settings">
    <div class="section-header">
      <h3>{{ t('components.settings.dependencySettings.title') }}</h3>
      <p class="section-desc">{{ t('components.settings.dependencySettings.description') }}</p>
    </div>
    
    <div class="install-path" v-if="installPath">
      <span class="label">{{ t('components.settings.dependencySettings.installPath') }}</span>
      <code>{{ installPath }}</code>
    </div>
    
    <!-- 安装进度消息 -->
    <div v-if="progressMessage" class="progress-message" :class="progressType">
      <i :class="progressIcon"></i>
      <span>{{ progressMessage }}</span>
    </div>
    
    <!-- 按工具分组的依赖面板 -->
    <div class="tool-panels">
      <div
        v-for="panel in toolPanels"
        :key="panel.toolName"
        class="tool-panel"
      >
        <!-- 工具面板头部 -->
        <div
          class="panel-header"
          :class="{ expanded: expandedPanels.has(panel.toolName) }"
          @click="togglePanel(panel.toolName)"
        >
          <i class="codicon codicon-chevron-right expand-icon"></i>
          <span class="panel-title">{{ panel.displayName }}</span>
          <span class="deps-count" :class="{ 'all-installed': areAllDepsInstalled(panel.dependencies) }">
            {{ getInstalledCount(panel.dependencies) }}/{{ panel.dependencies.length }}
          </span>
        </div>
        
        <!-- 工具面板内容 -->
        <div v-if="expandedPanels.has(panel.toolName)" class="panel-content">
          <div
            v-for="depName in panel.dependencies"
            :key="depName"
            class="dependency-item"
            :class="{ installed: isDependencyInstalled(depName) }"
          >
            <div class="dep-info">
              <div class="dep-header">
                <span class="dep-name">{{ depName }}</span>
                <span class="dep-version">{{ getDependencyInfo(depName)?.version || '' }}</span>
                <span v-if="isDependencyInstalled(depName)" class="dep-installed-badge">
                  <i class="codicon codicon-check"></i>
                  {{ t('components.settings.dependencySettings.installed') }}
                </span>
              </div>
              <p class="dep-description">{{ getDependencyInfo(depName)?.description || '' }}</p>
              <div class="dep-meta" v-if="getDependencyInfo(depName)?.estimatedSize">
                <span class="dep-size">
                  <i class="codicon codicon-database"></i>
                  {{ t('components.settings.dependencySettings.estimatedSize', { size: getDependencyInfo(depName)?.estimatedSize }) }}
                </span>
              </div>
            </div>
            
            <div class="dep-actions">
              <button
                v-if="!isDependencyInstalled(depName)"
                class="action-button install-btn"
                :disabled="installing === depName"
                @click.stop="installDependency(depName)"
              >
                <i v-if="installing === depName" class="codicon codicon-loading codicon-modifier-spin"></i>
                <i v-else class="codicon codicon-cloud-download"></i>
                {{ installing === depName ? t('components.settings.dependencySettings.installing') : t('components.settings.dependencySettings.install') }}
              </button>
              
              <button
                v-else
                class="action-button uninstall-btn"
                :disabled="uninstalling === depName"
                @click.stop="uninstallDependency(depName)"
              >
                <i v-if="uninstalling === depName" class="codicon codicon-loading codicon-modifier-spin"></i>
                <i v-else class="codicon codicon-trash"></i>
                {{ uninstalling === depName ? t('components.settings.dependencySettings.uninstalling') : t('components.settings.dependencySettings.uninstall') }}
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="toolPanels.length === 0" class="empty-state">
        <i class="codicon codicon-package"></i>
        <p>{{ t('components.settings.dependencySettings.empty') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { onExtensionMessageType, sendToExtension } from '../../utils/vscode';
import { TOOL_DEPENDENCIES } from '../../composables/useDependency';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface DependencyInfo {
  name: string;
  version: string;
  description: string;
  installed: boolean;
  installedVersion?: string;
  estimatedSize?: number;
}

interface ToolPanel {
  toolName: string;
  displayName: string;
  dependencies: string[];
}

const dependencies = ref<DependencyInfo[]>([]);
const installPath = ref<string>('');
const installing = ref<string | null>(null);
const uninstalling = ref<string | null>(null);
const progressMessage = ref<string>('');
const progressType = ref<'info' | 'success' | 'error'>('info');
let disposeDependencyProgress: (() => void) | null = null;

// 展开的面板（记住状态）
const STORAGE_KEY = 'limcode.dependencyPanels.expanded';
const expandedPanels = ref<Set<string>>(new Set());

// 从 localStorage 恢复展开状态
function loadExpandedState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const arr = JSON.parse(saved) as string[];
      expandedPanels.value = new Set(arr);
    }
  } catch {
    // 忽略错误
  }
}

// 保存展开状态到 localStorage
function saveExpandedState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...expandedPanels.value]));
  } catch {
    // 忽略错误
  }
}

// 切换面板展开状态
function togglePanel(toolName: string) {
  if (expandedPanels.value.has(toolName)) {
    expandedPanels.value.delete(toolName);
  } else {
    expandedPanels.value.add(toolName);
  }
  saveExpandedState();
}

// 工具面板列表
const toolPanels = computed<ToolPanel[]>(() => {
  const panels: ToolPanel[] = [];
  
  for (const [toolName, deps] of Object.entries(TOOL_DEPENDENCIES)) {
    if (deps.length > 0) {
      panels.push({
        toolName,
        displayName: getToolDisplayName(toolName),
        dependencies: deps
      });
    }
  }
  
  return panels;
});

// 获取工具显示名称
function getToolDisplayName(name: string): string {
  // 可以在这里添加工具名称的国际化映射
  // 目前使用默认格式化：将下划线转为空格并首字母大写
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// 检查依赖是否已安装
function isDependencyInstalled(depName: string): boolean {
  const dep = dependencies.value.find(d => d.name === depName);
  return dep?.installed ?? false;
}

// 获取依赖信息
function getDependencyInfo(depName: string): DependencyInfo | undefined {
  return dependencies.value.find(d => d.name === depName);
}

// 检查面板中所有依赖是否已安装
function areAllDepsInstalled(deps: string[]): boolean {
  return deps.every(dep => isDependencyInstalled(dep));
}

// 获取已安装的依赖数量
function getInstalledCount(deps: string[]): number {
  return deps.filter(dep => isDependencyInstalled(dep)).length;
}

const progressIcon = computed(() => {
  switch (progressType.value) {
    case 'success':
      return 'codicon codicon-check';
    case 'error':
      return 'codicon codicon-error';
    default:
      return 'codicon codicon-info';
  }
});

// 加载依赖列表
async function loadDependencies() {
  try {
    const result = await sendToExtension<{ dependencies: DependencyInfo[] }>('dependencies.list', {});
    dependencies.value = result.dependencies || [];
  } catch (error) {
    console.error('Failed to load dependencies:', error);
  }
}

// 获取安装路径
async function getInstallPath() {
  try {
    const result = await sendToExtension<{ path: string }>('dependencies.getInstallPath', {});
    installPath.value = result.path || '';
  } catch (error) {
    console.error('Failed to get install path:', error);
  }
}

// 安装依赖
async function installDependency(name: string) {
  installing.value = name;
  progressMessage.value = '';
  
  try {
    const result = await sendToExtension<{ success: boolean }>('dependencies.install', { name });
    
    if (result.success) {
      progressType.value = 'success';
      progressMessage.value = t('components.settings.dependencySettings.progress.installSuccess', { name });
      await loadDependencies();
    } else {
      progressType.value = 'error';
      progressMessage.value = t('components.settings.dependencySettings.progress.installFailed', { name });
    }
  } catch (error: any) {
    progressType.value = 'error';
    progressMessage.value = t('components.settings.dependencySettings.progress.installFailed', { name }) + ': ' + (error.message || t('components.settings.dependencySettings.progress.unknownError'));
  } finally {
    installing.value = null;
  }
}

// 卸载依赖
async function uninstallDependency(name: string) {
  uninstalling.value = name;
  progressMessage.value = '';
  
  try {
    const result = await sendToExtension<{ success: boolean }>('dependencies.uninstall', { name });
    
    if (result.success) {
      progressType.value = 'success';
      progressMessage.value = t('components.settings.dependencySettings.progress.uninstallSuccess', { name });
      await loadDependencies();
    } else {
      progressType.value = 'error';
      progressMessage.value = t('components.settings.dependencySettings.progress.uninstallFailed', { name });
    }
  } catch (error: any) {
    progressType.value = 'error';
    progressMessage.value = t('components.settings.dependencySettings.progress.uninstallFailed', { name }) + ': ' + (error.message || t('components.settings.dependencySettings.progress.unknownError'));
  } finally {
    uninstalling.value = null;
  }
}

// 监听进度事件
function handleProgressEvent(event: any) {
  const { type, dependency, message, error } = event;
  
  switch (type) {
    case 'start':
    case 'progress':
      progressType.value = 'info';
      progressMessage.value = message || t('components.settings.dependencySettings.progress.processing', { dependency });
      break;
    case 'complete':
      progressType.value = 'success';
      progressMessage.value = message || t('components.settings.dependencySettings.progress.complete', { dependency });
      break;
    case 'error':
      progressType.value = 'error';
      progressMessage.value = error || t('components.settings.dependencySettings.progress.failed', { dependency });
      break;
  }
}

onMounted(() => {
  loadExpandedState();
  loadDependencies();
  getInstallPath();
  disposeDependencyProgress = onExtensionMessageType(
    'dependencyProgress',
    message => handleProgressEvent(message.data),
    'DependencySettings'
  );
});

onUnmounted(() => {
  disposeDependencyProgress?.();
  disposeDependencyProgress = null;
});
</script>

<style scoped>
.dependency-settings {
  padding: 16px;
}

.section-header {
  margin-bottom: 16px;
}

.section-header h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.section-desc {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
}

.install-path {
  margin-bottom: 16px;
  padding: 8px 12px;
  background: var(--vscode-textBlockQuote-background);
  border-radius: 4px;
  font-size: 12px;
}

.install-path .label {
  color: var(--vscode-descriptionForeground);
}

.install-path code {
  color: var(--vscode-textLink-foreground);
  font-family: var(--vscode-editor-font-family);
}

.dependencies-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dependency-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  transition: border-color 0.2s;
}

.dependency-item:hover {
  border-color: var(--vscode-focusBorder);
}

.dependency-item.installed {
  border-color: var(--vscode-charts-green);
  background: color-mix(in srgb, var(--vscode-charts-green) 5%, var(--vscode-editor-background));
}

.dep-info {
  flex: 1;
  min-width: 0;
}

.dep-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dep-name {
  font-weight: 600;
  color: var(--vscode-foreground);
}

.dep-version {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
}

.dep-installed-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--vscode-charts-green);
  background: color-mix(in srgb, var(--vscode-charts-green) 15%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
}

.dep-description {
  margin: 6px 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
}

.dep-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.dep-size {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dep-actions {
  flex-shrink: 0;
  margin-left: 16px;
}

.action-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.action-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.install-btn {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.install-btn:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.uninstall-btn {
  background: transparent;
  color: var(--vscode-errorForeground);
  border: 1px solid var(--vscode-errorForeground);
}

.uninstall-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  color: var(--vscode-descriptionForeground);
}

.empty-state i {
  font-size: 24px;
  opacity: 0.5;
}

.progress-message {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 4px;
  font-size: 12px;
}

.progress-message.info {
  background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent);
  color: var(--vscode-textLink-foreground);
}

.progress-message.success {
  background: color-mix(in srgb, var(--vscode-charts-green) 10%, transparent);
  color: var(--vscode-charts-green);
}

.progress-message.error {
  background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
  color: var(--vscode-errorForeground);
}

/* 工具面板样式 */
.tool-panels {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--vscode-editor-background);
  cursor: pointer;
  transition: background-color 0.15s;
}

.panel-header:hover {
  background: var(--vscode-list-hoverBackground);
}

.panel-header .expand-icon {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  transition: transform 0.15s;
}

.panel-header.expanded .expand-icon {
  transform: rotate(90deg);
}

.panel-title {
  flex: 1;
  font-weight: 500;
  font-size: 13px;
  color: var(--vscode-foreground);
}

.deps-count {
  padding: 2px 8px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.deps-count.all-installed {
  background: color-mix(in srgb, var(--vscode-charts-green) 20%, transparent);
  color: var(--vscode-charts-green);
}

.panel-content {
  padding: 8px;
  background: var(--vscode-sideBar-background);
  border-top: 1px solid var(--vscode-panel-border);
}

.panel-content .dependency-item {
  margin-bottom: 8px;
}

.panel-content .dependency-item:last-child {
  margin-bottom: 0;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}
</style>
