// 任务创建 composable
import { ref, computed, reactive, onMounted, type Ref } from 'vue';

import type { DatabaseConfig } from '@/api/genModelTaskApi';
import type {
  TaskType,
  TaskPriority,
  TaskCreationRequest,
  ParseTaskParameters,
  ModelGenParameters,
} from '@/types/task';

import { taskCreate, taskValidateName, taskStart, getServerConfig } from '@/api/genModelTaskApi';
import { useTaskCreationStore } from '@/composables/useTaskCreationStore';

// ============ 表单数据类型 ============

export type TaskCreationFormData = {
  // 基础信息
  name: string;
  type: TaskType;
  priority: TaskPriority;
  description: string;

  // 解析任务参数
  parseMode: 'all' | 'dbnum' | 'refno';
  dbnum: string;
  refno: string;

  // 模型生成任务参数
  generateModels: boolean;
  generateMesh: boolean;
  generateSpatialTree: boolean;
  applyBooleanOperation: boolean;
  meshTolRatio: number;
  maxConcurrent: number;
  exportWebBundle: boolean;  // 导出 Web 数据包
  enabledNouns: string[];
  nounInput: string;
  limitPerNounType: string;
};

export type ValidationErrors = Partial<Record<keyof TaskCreationFormData, string>>;

const TASK_NAME_MAX_LENGTH = 200;
const NOUN_PATTERN = /^[A-Za-z]+$/;

export type UseTaskCreationReturn = {
  /** 当前步骤 (1-3) */
  currentStep: Ref<number>;
  /** 表单数据 */
  formData: TaskCreationFormData;
  /** 验证错误 */
  errors: Ref<ValidationErrors>;
  /** 是否正在加载 */
  loading: Ref<boolean>;
  /** 是否正在验证名称 */
  validatingName: Ref<boolean>;
  /** 名称是否可用 */
  nameAvailable: Ref<boolean | null>;
  /** 提交错误 */
  submitError: Ref<string | null>;
  /** 提交成功的任务 ID */
  createdTaskId: Ref<string | null>;

  /** 是否正在处理步骤切换 */
  stepProcessing: Ref<boolean>;

  /** 当前步骤是否有效 */
  isCurrentStepValid: import('vue').ComputedRef<boolean>;
  /** 是否可以提交 */
  canSubmit: import('vue').ComputedRef<boolean>;

  /** 下一步 */
  nextStep: () => Promise<boolean>;
  /** 上一步 */
  prevStep: () => void;
  /** 跳转到指定步骤 */
  goToStep: (step: number) => void;
  /** 验证任务名称 */
  validateName: () => Promise<boolean>;
  /** 验证当前步骤 */
  validateCurrentStep: () => boolean;
  /** 提交任务 */
  submitTask: () => Promise<boolean>;
  /** 重置表单 */
  resetForm: () => void;
  /** 应用预设类型 */
  applyPresetType: () => void;
  /** 后端服务器配置（动态加载） */
  serverConfig: Ref<DatabaseConfig | null>;
  /** 添加单个 noun 过滤项 */
  addNoun: (rawValue: string) => boolean;
  /** 移除单个 noun 过滤项 */
  removeNoun: (noun: string) => void;
  /** 批量设置 noun 过滤项 */
  setEnabledNouns: (values: string[]) => void;
  /** 当前 noun 输入是否无效 */
  nounInputInvalid: import('vue').ComputedRef<boolean>;
  /** noun 输入错误文案 */
  nounInputError: import('vue').ComputedRef<string>;
};

/**
 * 任务创建 composable
 */
export function useTaskCreation(): UseTaskCreationReturn {
  // ============ 状态 ============

  const currentStep = ref(1);
  const loading = ref(false);
  const validatingName = ref(false);
  const nameAvailable = ref<boolean | null>(null);
  const submitError = ref<string | null>(null);
  const createdTaskId = ref<string | null>(null);
  const errors = ref<ValidationErrors>({});

  const taskCreationStore = useTaskCreationStore();

  // 后端配置（动态加载）
  const serverConfig = ref<DatabaseConfig | null>(null);

  onMounted(async () => {
    try {
      serverConfig.value = await getServerConfig();
    } catch (e) {
      console.warn('获取服务器配置失败，将使用默认值:', e);
    }
  });

  // 表单数据
  const formData = reactive<TaskCreationFormData>({
    // 基础信息
    name: '',
    type: 'DataParsingWizard',
    priority: 'normal',
    description: '',

    // 解析任务参数
    parseMode: 'all',
    dbnum: '',
    refno: '',

    // 模型生成任务参数
    generateModels: true,
    generateMesh: true,
    generateSpatialTree: false,
    applyBooleanOperation: false,
    meshTolRatio: 0.01,
    maxConcurrent: 4,
    exportWebBundle: true,  // 默认开启 Web 数据包导出
    enabledNouns: [],
    nounInput: '',
    limitPerNounType: '',
  });

  const stepProcessing = ref(false);

  // ============ 计算属性 ============

  /** 当前步骤是否有效 */
  const isCurrentStepValid = computed(() => {
    // 步骤1需要特殊处理：名称必须可用
    if (currentStep.value === 1) {
      return checkStepValid(1) && nameAvailable.value === true;
    }
    return checkStepValid(currentStep.value);
  });

  /** 是否可以提交 */
  const canSubmit = computed(() => {
    return (
      currentStep.value === 3 &&
      checkStepValid(1) &&
      checkStepValid(2) &&
      checkStepValid(3) &&
      nameAvailable.value === true
    );
  });

  const nounInputError = computed(() => {
    const normalized = normalizeNoun(formData.nounInput);
    if (!normalized) {
      return '';
    }
    if (!NOUN_PATTERN.test(normalized)) {
      return 'Noun must contain alphabetic characters only';
    }
    if (formData.enabledNouns.includes(normalized)) {
      return 'Noun already added';
    }
    return '';
  });

  const nounInputInvalid = computed(() => nounInputError.value.length > 0);

  /**
   * 纯函数检查步骤是否有效（不修改 errors，用于 computed）
   */
  function checkStepValid(step: number): boolean {
    if (step === 1) {
      const trimmedName = formData.name.trim();
      if (!trimmedName || trimmedName.length > TASK_NAME_MAX_LENGTH) {
        return false;
      }
      if (!formData.type) {
        return false;
      }
    }

    if (step === 2) {
      if (formData.type === 'DataParsingWizard') {
        if (formData.parseMode === 'dbnum') {
          const parts = formData.dbnum.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
          if (parts.length === 0 || parts.some(s => isNaN(Number(s)))) {
            return false;
          }
        }
        if (formData.parseMode === 'refno' && !formData.refno.trim()) {
          return false;
        }
      }

      if (formData.type === 'DataGeneration') {
        if (!formData.generateModels && !formData.generateMesh && !formData.generateSpatialTree) {
          return false;
        }
        const hasDbnum = formData.dbnum.trim().length > 0;
        const hasRefno = formData.refno.trim().length > 0;
        if (hasDbnum && hasRefno) {
          return false;
        }
        if (hasDbnum && !isDbnumInputValid(formData.dbnum)) {
          return false;
        }
        if (hasRefno && !isRefnoInputValid(formData.refno)) {
          return false;
        }
        if (formData.meshTolRatio <= 0 || formData.meshTolRatio > 1) {
          return false;
        }
        if (formData.maxConcurrent < 1 || formData.maxConcurrent > 16) {
          return false;
        }
        if (!isLimitPerNounTypeValid()) {
          return false;
        }
      }
    }

    return true;
  }

  function getLimitPerNounTypeValue(): number | null {
    const rawValue = formData.limitPerNounType.trim();
    if (!rawValue) {
      return null;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return NaN;
    }

    return parsed;
  }

  function isLimitPerNounTypeValid(): boolean {
    const parsed = getLimitPerNounTypeValue();
    return parsed === null || (Number.isInteger(parsed) && parsed > 0);
  }

  function isDbnumInputValid(value: string): boolean {
    return /^\d+$/.test(value.trim());
  }

  function isRefnoInputValid(value: string): boolean {
    return /^\d+_\d+$/.test(value.trim());
  }

  function getLimitPerNounTypeError(): string | null {
    const rawValue = formData.limitPerNounType.trim();
    if (!rawValue) {
      return null;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return 'Limit must be a number';
    }
    if (parsed <= 0) {
      return 'Limit must be greater than 0';
    }

    return null;
  }

  function normalizeNoun(value: string): string {
    return value.trim().toUpperCase();
  }

  function isValidNoun(value: string): boolean {
    return NOUN_PATTERN.test(value);
  }

  function normalizeEnabledNouns(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map(normalizeNoun)
          .filter(value => value.length > 0 && isValidNoun(value))
      )
    );
  }

  function syncEnabledNouns(values: string[]): void {
    formData.enabledNouns = normalizeEnabledNouns(values);
  }

  function addNoun(rawValue: string): boolean {
    const normalized = normalizeNoun(rawValue);
    formData.nounInput = '';
    if (!normalized || !isValidNoun(normalized) || formData.enabledNouns.includes(normalized)) {
      return false;
    }
    syncEnabledNouns([...formData.enabledNouns, normalized]);
    return true;
  }

  function removeNoun(noun: string): void {
    const normalized = normalizeNoun(noun);
    syncEnabledNouns(formData.enabledNouns.filter(item => item !== normalized));
  }

  function setEnabledNouns(values: string[]): void {
    syncEnabledNouns(values);
    formData.nounInput = '';
  }

  /**
   * 验证指定步骤（会修改 errors，用于按钮点击时的验证）
   */
  function validateStep(step: number): boolean {
    const newErrors: ValidationErrors = {};

    if (step === 1) {
      const trimmedName = formData.name.trim();
      if (!trimmedName) {
        newErrors.name = 'Task name is required';
      } else if (trimmedName.length > TASK_NAME_MAX_LENGTH) {
        newErrors.name = 'Task name must be less than 200 characters';
      }
      if (!formData.type) {
        newErrors.type = '请选择任务类型';
      }
    }

    if (step === 2) {
      if (formData.type === 'DataParsingWizard') {
        if (formData.parseMode === 'dbnum') {
          const parts = formData.dbnum.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
          if (parts.length === 0) {
            newErrors.dbnum = '请输入数据库编号';
          } else if (parts.some(s => isNaN(Number(s)))) {
            newErrors.dbnum = '数据库编号必须是数字，多个用逗号分隔';
          }
        }
        if (formData.parseMode === 'refno' && !formData.refno.trim()) {
          newErrors.refno = '请输入参考号';
        }
      }

      if (formData.type === 'DataGeneration') {
        if (!formData.generateModels && !formData.generateMesh && !formData.generateSpatialTree) {
          newErrors.generateModels = '请至少选择一项生成内容';
        }
        const hasDbnum = formData.dbnum.trim().length > 0;
        const hasRefno = formData.refno.trim().length > 0;
        if (hasDbnum && hasRefno) {
          newErrors.dbnum = 'Cannot specify both dbnum and refno';
          newErrors.refno = 'Cannot specify both dbnum and refno';
        } else {
          if (hasDbnum && !isDbnumInputValid(formData.dbnum)) {
            newErrors.dbnum = 'Database number must be numeric';
          }
          if (hasRefno && !isRefnoInputValid(formData.refno)) {
            newErrors.refno = 'Invalid refno format (expected: dbnum_sequence)';
          }
        }
        if (formData.meshTolRatio <= 0 || formData.meshTolRatio > 1) {
          newErrors.meshTolRatio = '网格容差比例必须在 0-1 之间';
        }
        if (formData.maxConcurrent < 1 || formData.maxConcurrent > 16) {
          newErrors.maxConcurrent = '并发数必须在 1-16 之间';
        }
        const limitError = getLimitPerNounTypeError();
        if (limitError) {
          newErrors.limitPerNounType = limitError;
        }
      }
    }

    // 更新错误状态
    if (Object.keys(newErrors).length > 0) {
      errors.value = { ...errors.value, ...newErrors };
    }
    if (step === 1) {
      if (!newErrors.name && errors.value.name && errors.value.name !== 'Task name already exists') delete errors.value.name;
      if (!newErrors.type && errors.value.type) delete errors.value.type;
    }
    if (step === 2) {
      for (const field of ['dbnum', 'refno', 'generateModels', 'meshTolRatio', 'maxConcurrent', 'limitPerNounType'] as const) {
        if (!newErrors[field]) {
          delete errors.value[field];
        }
      }
    }

    return Object.keys(newErrors).length === 0;
  }

  /**
   * 验证当前步骤
   */
  function validateCurrentStep(): boolean {
    return validateStep(currentStep.value);
  }

  /**
   * 验证任务名称（异步）
   */
  async function validateName(): Promise<boolean> {
    if (!formData.name.trim()) {
      nameAvailable.value = null;
      return false;
    }

    validatingName.value = true;
    try {
      const response = await taskValidateName(formData.name);
      nameAvailable.value = response.available;
      if (!response.available) {
        errors.value.name = 'Task name already exists';
      } else {
        delete errors.value.name;
      }
      return response.available;
    } catch (e) {
      // 如果验证接口不可用，假设名称可用
      console.warn('Name validation failed:', e);
      nameAvailable.value = true;
      return true;
    } finally {
      validatingName.value = false;
    }
  }

  // ============ 步骤导航 ============

  /**
   * 下一步
   */
  async function nextStep(): Promise<boolean> {
    stepProcessing.value = true;
    try {
      // 步骤1额外检查：必须验证名称
      if (currentStep.value === 1) {
        // 如果尚未验证或验证失败
        if (nameAvailable.value !== true) {
          const valid = await validateName();
          if (!valid) return false;
        }
      }

      if (!validateCurrentStep()) {
        return false;
      }

      if (currentStep.value < 3) {
        currentStep.value++;
        return true;
      }
      return false;
    } finally {
      stepProcessing.value = false;
    }
  }

  /**
   * 上一步
   */
  function prevStep(): void {
    if (currentStep.value > 1) {
      currentStep.value--;
    }
  }

  /**
   * 跳转到指定步骤
   */
  function goToStep(step: number): void {
    if (step >= 1 && step <= 3) {
      // 只能跳转到已完成的步骤或当前步骤
      // 或者如果从步骤1跳转，需要确保步骤1有效
      if (step > currentStep.value) {
        // 尝试跳转到未来步骤，这里简单处理：不允许跳过中间步骤
        // 但允许点击已完成的步骤回去
        return;
      }
      currentStep.value = step;
    }
  }

  // ============ 表单提交 ============
  // ... (保持不变)

  // (需要同步更新返回值类型 UseTaskCreationReturn 和 return 对象)

  /**
   * 构建请求数据
   */
  function buildRequest(): any {
    const cfg = serverConfig.value;
    const trimmedDbnum = formData.dbnum.trim();
    const trimmedRefno = formData.refno.trim();
    const manualDbNums = formData.type === 'DataGeneration'
      ? (trimmedDbnum ? [Number(trimmedDbnum)] : [])
      : (formData.parseMode === 'dbnum'
        ? formData.dbnum.split(/[,，\s]+/).map(s => s.trim()).filter(s => s && !isNaN(Number(s))).map(Number)
        : []);
    const manualRefnos = formData.type === 'DataGeneration'
      ? (trimmedRefno ? [trimmedRefno] : [])
      : (formData.parseMode === 'refno' ? [trimmedRefno] : []);
    // 后端真正的请求结构是 CreateTaskRequest { name, task_type, config }
    const request: any = {
      name: formData.name.trim(),
      task_type: formData.type === 'DataParsingWizard' ? 'DataParsingWizard' : 'DataGeneration',
      config: {
        name: formData.name.trim(),
        manual_db_nums: manualDbNums,
        manual_refnos: manualRefnos,
        // 使用后端配置，回退到默认值
        project_name: cfg?.project_name ?? 'AvevaMarineSample',
        project_path: cfg?.project_path ?? '',
        project_code: cfg?.project_code ?? 1516,
        mdb_name: cfg?.mdb_name ?? 'ALL',
        module: cfg?.module ?? 'DESI',
        db_type: cfg?.db_type ?? 'surrealdb',
        surreal_ns: cfg?.surreal_ns ?? 1516,
        db_ip: cfg?.db_ip ?? 'localhost',
        db_port: cfg?.db_port ?? '8020',
        db_user: cfg?.db_user ?? 'root',
        db_password: cfg?.db_password ?? 'root',
        // 任务开关
        gen_model: formData.type === 'DataGeneration' ? formData.generateModels : true,
        gen_mesh: formData.type === 'DataGeneration' ? formData.generateMesh : false,
        gen_spatial_tree: formData.type === 'DataGeneration' ? formData.generateSpatialTree : true,
        apply_boolean_operation: formData.type === 'DataGeneration' ? formData.applyBooleanOperation : true,
        mesh_tol_ratio: formData.type === 'DataGeneration' ? formData.meshTolRatio : 3.0,
        room_keyword: cfg?.room_keyword ?? '-RM',
        enabled_nouns: formData.enabledNouns,
        ...(formData.type === 'DataGeneration' && getLimitPerNounTypeValue() !== null
          ? { debug_limit_per_noun_type: getLimitPerNounTypeValue() }
          : {}),
      },
    };

    return request;
  }

  /**
   * 提交任务
   */
  async function submitTask(): Promise<boolean> {
    // 验证所有步骤
    if (!validateStep(1) || !validateStep(2)) {
      submitError.value = '请检查表单填写是否完整';
      return false;
    }

    loading.value = true;
    submitError.value = null;
    createdTaskId.value = null;

    try {
      const request = buildRequest();
      const response = await taskCreate(request);

      if (response.success && response.taskId) {
        createdTaskId.value = response.taskId;
        // 自动启动任务
        try {
          await taskStart(response.taskId);
        } catch (e) {
          console.warn('自动启动任务失败:', e);
        }
        return true;
      } else {
        submitError.value = response.error_message || response.message || '创建任务失败';
        return false;
      }
    } catch (e) {
      submitError.value = `创建任务失败: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 重置表单
   */
  function resetForm(): void {
    currentStep.value = 1;
    errors.value = {};
    submitError.value = null;
    createdTaskId.value = null;
    nameAvailable.value = null;
    stepProcessing.value = false;

    // 重置表单数据
    formData.name = '';
    formData.type = 'DataParsingWizard';
    formData.priority = 'normal';
    formData.description = '';
    formData.parseMode = 'all';
    formData.dbnum = '';
    formData.refno = '';
    formData.generateModels = true;
    formData.generateMesh = true;
    formData.generateSpatialTree = false;
    formData.applyBooleanOperation = false;
    formData.meshTolRatio = 0.01;
    formData.maxConcurrent = 4;
    formData.exportWebBundle = true;
    formData.enabledNouns = [];
    formData.nounInput = '';
    formData.limitPerNounType = '';
  }

  /**
   * 应用预设类型（从 store 获取）
   * 用于从 Ribbon 菜单点击特定任务类型按钮时
   */
  function applyPresetType(): void {
    const presetType = taskCreationStore.consumePresetType();
    if (presetType) {
      formData.type = presetType;
    }
  }

  return {
    // 状态
    currentStep,
    formData,
    errors,
    loading,
    validatingName,
    nameAvailable,
    submitError,
    createdTaskId,
    stepProcessing, // 新增

    // 计算属性
    isCurrentStepValid,
    canSubmit,

    // 方法
    nextStep,
    prevStep,
    goToStep,
    validateName,
    validateCurrentStep,
    submitTask,
    resetForm,
    applyPresetType,
    serverConfig,
    addNoun,
    removeNoun,
    setEnabledNouns,
    nounInputInvalid,
    nounInputError,
  };
}
