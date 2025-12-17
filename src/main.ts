import '@/assets/tailwind.css';
import '@/assets/main.scss';
import 'dockview-vue/dist/styles/dockview.css';
import { createApp } from 'vue';

import App from '@/App.vue';
import AnnotationPanelDock from '@/components/dock_panels/AnnotationPanelDock.vue';
import HydraulicPanelDock from '@/components/dock_panels/HydraulicPanelDock.vue';
import ManagerPanelDock from '@/components/dock_panels/ManagerPanelDock.vue';
import MeasurementPanelDock from '@/components/dock_panels/MeasurementPanelDock.vue';
import ModelQueryPanelDock from '@/components/dock_panels/ModelQueryPanelDock.vue';
import ModelTreePanelDock from '@/components/dock_panels/ModelTreePanelDock.vue';
import PropertiesPanelDock from '@/components/dock_panels/PropertiesPanelDock.vue';
import ReviewerTaskListPanelDock from '@/components/dock_panels/ReviewerTaskListPanelDock.vue';
import ReviewPanelDock from '@/components/dock_panels/ReviewPanelDock.vue';
import InitiateReviewPanelDock from '@/components/dock_panels/InitiateReviewPanelDock.vue';
import ViewerPanel from '@/components/dock_panels/ViewerPanel.vue';
import vuetify from '@/plugins/vuetify';

const app = createApp(App);

app.component('ViewerPanel', ViewerPanel);
app.component('ModelTreePanel', ModelTreePanelDock);
app.component('MeasurementPanel', MeasurementPanelDock);
app.component('AnnotationPanel', AnnotationPanelDock);
app.component('HydraulicPanel', HydraulicPanelDock);
app.component('ManagerPanel', ManagerPanelDock);
app.component('PropertiesPanel', PropertiesPanelDock);
app.component('ModelQueryPanel', ModelQueryPanelDock);
app.component('ReviewPanel', ReviewPanelDock);
app.component('InitiateReviewPanel', InitiateReviewPanelDock);
app.component('ReviewerTaskListPanel', ReviewerTaskListPanelDock);

app.use(vuetify).mount('#app');
