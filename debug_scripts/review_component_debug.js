// 调试三维校审单构件问题的脚本
// 使用方法：在浏览器控制台中运行此脚本

async function debugReviewComponents() {
  console.log('=== 开始调试三维校审单构件问题 ===');
    
  try {
    // 1. 检查当前用户信息
    const userStore = window.__VUE_DEV_TOOLS_GLOBAL_HOOK__.apps.find(app => 
      app._instance?.appContext?.config?.globalProperties?.$userStore
    )?._instance?.appContext?.config?.globalProperties?.$userStore;
        
    if (!userStore) {
      console.error('无法找到 userStore，请确保在正确的页面运行');
      return;
    }
        
    console.log('当前用户:', userStore.currentUser.value);
    console.log('当前任务列表数量:', userStore.reviewTasks.value.length);
        
    // 2. 获取当前任务ID（假设你在任务详情页面）
    const currentUrl = window.location.href;
    const urlMatch = currentUrl.match(/form_id=([^&]+)/);
    const formId = urlMatch ? urlMatch[1] : null;
        
    console.log('当前页面 formId:', formId);
        
    // 3. 检查当前任务
    const reviewStore = window.__VUE_DEV_TOOLS_GLOBAL_HOOK__.apps.find(app => 
      app._instance?.appContext?.config?.globalProperties?.$reviewStore
    )?._instance?.appContext?.config?.globalProperties?.$reviewStore;
        
    if (reviewStore?.currentTask?.value) {
      const task = reviewStore.currentTask.value;
      console.log('当前任务详情:', {
        id: task.id,
        title: task.title,
        formId: task.formId,
        componentCount: task.components?.length || 0,
        components: task.components
      });
    }
        
    // 4. 直接调用API检查数据
    const baseUrl = window.location.origin;
    const token = localStorage.getItem('review_auth_token');
        
    if (token && formId) {
      console.log('=== 直接API调用检查 ===');
            
      // 获取任务列表
      const listResponse = await fetch(`${baseUrl}/api/review/tasks`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
            
      if (listResponse.ok) {
        const listData = await listResponse.json();
        console.log('API返回的任务列表:', listData.tasks?.length || 0, '个任务');
                
        // 查找当前formId对应的任务
        const currentTask = listData.tasks?.find(task => task.formId === formId);
        if (currentTask) {
          console.log('找到当前任务:', {
            id: currentTask.id,
            title: currentTask.title,
            componentCount: currentTask.components?.length || 0,
            components: currentTask.components
          });
        } else {
          console.warn('未找到formId对应的任务:', formId);
        }
      } else {
        console.error('获取任务列表失败:', listResponse.status);
      }
            
      // 检查review_form_model表的数据
      try {
        const modelCheckResponse = await fetch(`${baseUrl}/api/review/tasks/debug/form-model/${formId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
                
        if (modelCheckResponse.ok) {
          const modelData = await modelCheckResponse.json();
          console.log('review_form_model表数据:', modelData);
        } else {
          console.log('review_form_model检查接口不存在或失败');
        }
      } catch (e) {
        console.log('review_form_model检查失败:', e.message);
      }
    }
        
    // 5. 检查前端状态
    console.log('=== 前端状态检查 ===');
    console.log('localStorage中的任务数据:', localStorage.getItem('plant3d-web-user-v3'));
        
    // 6. 提供修复建议
    console.log('=== 修复建议 ===');
    console.log('1. 尝试强制刷新任务列表:');
    console.log('   在控制台运行: userStore.loadReviewTasks()');
    console.log('2. 检查网络请求是否成功');
    console.log('3. 清除localStorage重新登录');
    console.log('4. 检查后端日志是否有错误');
        
  } catch (error) {
    console.error('调试过程中出错:', error);
  }
}

// 自动运行调试
debugReviewComponents();
