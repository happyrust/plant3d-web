import type { DatabaseConfig } from '@/api/genModelTaskApi';

export type DeploymentSiteStatus =
  | 'Configuring'
  | 'Deploying'
  | 'Running'
  | 'Failed'
  | 'Stopped'
  | 'Offline';

export type E3dProjectInfo = {
  name: string;
  path: string;
  project_code?: number | null;
  db_file_count?: number;
  size_bytes?: number;
  last_modified?: number | string;
  selected?: boolean;
  description?: string | null;
};

export type DeploymentSite = {
  id?: string | null;
  site_id: string;
  name: string;
  description?: string | null;
  e3d_projects?: E3dProjectInfo[];
  config: DatabaseConfig;
  status: DeploymentSiteStatus;
  url?: string | null;
  health_url?: string | null;
  env?: string | null;
  owner?: string | null;
  tags?: unknown;
  notes?: string | null;
  created_at?: number | string | null;
  updated_at?: number | string | null;
  last_health_check?: string | null;
  region?: string | null;
  project_name: string;
  project_path?: string | null;
  project_code?: number | null;
  frontend_url?: string | null;
  backend_url?: string | null;
  bind_host: string;
  bind_port?: number | null;
  last_seen_at?: string | null;
};

export type DeploymentSiteListResponse = {
  items: DeploymentSite[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
};

export type DeploymentSiteQueryParams = {
  q?: string;
  status?: string;
  owner?: string;
  env?: string;
  region?: string;
  project_name?: string;
  page?: number;
  per_page?: number;
  sort?: string;
  registry_ttl_secs?: number;
};

export type DeploymentSiteCreateRequest = {
  site_id: string;
  name: string;
  description?: string | null;
  root_directory?: string | null;
  selected_projects?: string[];
  config: DatabaseConfig;
  region?: string | null;
  project_name?: string | null;
  project_path?: string | null;
  project_code?: number | null;
  frontend_url?: string | null;
  backend_url?: string | null;
  bind_host?: string | null;
  bind_port?: number | null;
  env?: string | null;
  owner?: string | null;
  health_url?: string | null;
  tags?: unknown;
  notes?: string | null;
};

export type DeploymentSiteUpdateRequest = {
  site_id?: string;
  name?: string;
  description?: string | null;
  config?: DatabaseConfig;
  status?: DeploymentSiteStatus;
  url?: string | null;
  env?: string | null;
  owner?: string | null;
  health_url?: string | null;
  region?: string | null;
  project_name?: string | null;
  project_path?: string | null;
  project_code?: number | null;
  frontend_url?: string | null;
  backend_url?: string | null;
  bind_host?: string | null;
  bind_port?: number | null;
  last_seen_at?: string | null;
  tags?: unknown;
  notes?: string | null;
};

export type DeploymentSiteImportRequest = {
  path?: string;
  name?: string;
  description?: string | null;
  env?: string | null;
  owner?: string | null;
  region?: string | null;
  site_id?: string;
  frontend_url?: string | null;
  backend_url?: string | null;
  bind_host?: string | null;
  bind_port?: number | null;
  health_url?: string | null;
  tags?: unknown;
  notes?: string | null;
};

export type DeploymentSiteActionResponse = {
  status?: string;
  message?: string;
  item?: DeploymentSite;
  healthy?: boolean;
};

export type DeploymentSiteIdentity = {
  deployment_model?: string;
  web_listen_host?: string;
  web_listen_port?: number;
  site_id?: string | null;
  site_name?: string | null;
  region?: string | null;
  frontend_url?: string | null;
  backend_url?: string | null;
  public_base_url?: string | null;
  project_name?: string;
  project_code?: number | null;
  project_path?: string;
  bind_host?: string;
  bind_port?: number;
  registration_status?: string;
  sites_list_endpoints?: string[];
  note?: string;
};
