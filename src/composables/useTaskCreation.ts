// 任务创建 composable
import { ref, computed, reactive, onMounted } from 'vue';
import type {
  TaskType,
  TaskPriority,
  TaskCreationRequest,
  ParseTaskParameters,
  ModelGenParameters,
} from '@/types/task';
import { taskCreate, taskValidateName } from '@/api/genModelTaskApi';
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
};

export type ValidationErrors = Partial<Record<keyof TaskCreationFormData, string>>;

export type UseTaskCreationReturn = {
  /** 当前步骤 (1-3) */
  currentStep: ReturnType<typeof ref<number>>;
  /** 表单数据 */
  formData: TaskCreationFormData;
  /** 验证错误 */
  errors: ReturnType<typeof ref<ValidationErrors>>;
  /** 是否正在加载 */
  loading: ReturnType<typeof ref<boolean>>;
  /** 是否正在验证名称 */
  validatingName: ReturnType<typeof ref<boolean>>;
  /** 名称是否可用 */
  nameAvailable: ReturnType<typeof ref<boolean | null>>;
  /** 提交错误 */
  submitError: ReturnType<typeof ref<string | null>>;
  /** 提交成功的任务 ID */
  createdTaskId: ReturnType<typeof ref<string | null>>;

  /** 是否正在处理步骤切换 */
  stepProcessing: ReturnType<typeof ref<boolean>>;

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

  /**
   * 纯函数检查步骤是否有效（不修改 errors，用于 computed）
   */
  function checkStepValid(step: number): boolean {
    if (step === 1) {
      if (!formData.name.trim() || formData.name.length < 2 || formData.name.length > 100) {
        return false;
      }
      if (!formData.type) {
        return false;
      }
    }

    if (step === 2) {
      if (formData.type === 'DataParsingWizard') {
        if (formData.parseMode === 'dbnum' && (!formData.dbnum.trim() || isNaN(Number(formData.dbnum)))) {
          return false;
        }
        if (formData.parseMode === 'refno' && !formData.refno.trim()) {
          return false;
        }
      }

      if (formData.type === 'DataGeneration') {
        if (!formData.generateModels && !formData.generateMesh && !formData.generateSpatialTree) {
          return false;
        }
        if (formData.meshTolRatio <= 0 || formData.meshTolRatio > 1) {
          return false;
        }
        if (formData.maxConcurrent < 1 || formData.maxConcurrent > 16) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 验证指定步骤（会修改 errors，用于按钮点击时的验证）
   */
  function validateStep(step: number): boolean {
    const newErrors: ValidationErrors = {};

    if (step === 1) {
      if (!formData.name.trim()) {
        newErrors.name = '请输入任务名称';
      } else if (formData.name.length < 2) {
        newErrors.name = '任务名称至少2个字符';
      } else if (formData.name.length > 100) {
        newErrors.name = '任务名称不能超过100个字符';
      }
      if (!formData.type) {
        newErrors.type = '请选择任务类型';
      }
    }

    if (step === 2) {
      if (formData.type === 'DataParsingWizard') {
        if (formData.parseMode === 'dbnum' && !formData.dbnum.trim()) {
          newErrors.dbnum = '请输入数据库编号';
        } else if (formData.parseMode === 'dbnum' && isNaN(Number(formData.dbnum))) {
          newErrors.dbnum = '数据库编号必须是数字';
        }
        if (formData.parseMode === 'refno' && !formData.refno.trim()) {
          newErrors.refno = '请输入参考号';
        }
      }

      if (formData.type === 'DataGeneration') {
        if (!formData.generateModels && !formData.generateMesh && !formData.generateSpatialTree) {
          newErrors.generateModels = '请至少选择一项生成内容';
        }
        if (formData.meshTolRatio <= 0 || formData.meshTolRatio > 1) {
          newErrors.meshTolRatio = '网格容差比例必须在 0-1 之间';
        }
        if (formData.maxConcurrent < 1 || formData.maxConcurrent > 16) {
          newErrors.maxConcurrent = '并发数必须在 1-16 之间';
        }
      }
    }

    // 更新错误状态
    if (Object.keys(newErrors).length > 0) {
      errors.value = { ...errors.value, ...newErrors };
    }
    if (step === 1) {
      if (!newErrors.name && errors.value.name && errors.value.name !== '任务名称已存在') delete errors.value.name;
      if (!newErrors.type && errors.value.type) delete errors.value.type;
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
        errors.value.name = '任务名称已存在';
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
  function buildRequest(): TaskCreationRequest {
    const request: TaskCreationRequest = {
      name: formData.name.trim(),
      task_type: formData.type,
      priority: formData.priority,
      description: formData.description.trim() || undefined,
      parameters: {} as TaskCreationRequest['parameters'],
    };

    if (formData.type === 'DataParsingWizard') {
      const parseParams: ParseTaskParameters = {
        parseMode: formData.parseMode,
      };
      if (formData.parseMode === 'dbnum') {
        parseParams.dbnum = Number(formData.dbnum);
      }
      if (formData.parseMode === 'refno') {
        parseParams.refno = formData.refno.trim();
      }
      request.parameters = parseParams;
    } else if (formData.type === 'DataGeneration') {
      const modelParams: ModelGenParameters = {
        generateModels: formData.generateModels,
        generateMesh: formData.generateMesh,
        generateSpatialTree: formData.generateSpatialTree,
        applyBooleanOperation: formData.applyBooleanOperation,
        meshTolRatio: formData.meshTolRatio,
        maxConcurrent: formData.maxConcurrent,
      };
      request.parameters = modelParams;
    }

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
  };
}
