const defaults: Record<string, string> = {
  PMS_E2E_BASE: 'http://pms.powerpms.net:1801',
  PMS_E2E_PASSWORD: 'Admin@1234',
  PMS_E2E_USERNAME: 'SJ',
  PMS_E2E_ROLES: 'SJ,JD,JH,SH,PZ',
  PMS_CHECKER_USERNAME: 'JH',
  PMS_EMBEDDED_SITE_SUBSTRING: '123.57.182.243',
  PMS_CDP_FULL_FLOW: '1',
  PMS_CDP_FILL_PMS_DIALOG: '1',
  PMS_CDP_SUBMIT_REVIEW: '1',
  PMS_CDP_VERIFY_PMS_API: '1',
  PMS_CDP_VERIFY_EMBED_API: '1',
  PMS_MOCK_PROJECT_CODE: 'AvevaPlantSample',
  PMS_MOCK_PROJECT_NAME: 'AvevaPlantSample',
  PMS_TARGET_BRAN_REFNO: '2013286704_477',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ||= value;
}

await import('../../scripts/pms-chrome-devtools-flow');
