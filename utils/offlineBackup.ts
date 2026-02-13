export const OFFLINE_SOURCE_BACKUP = {
  "README": "Backup functionality reset to prevent crash. Please use Export JSON for now."
};

export const getFullSourceBackup = () => {
    return JSON.stringify(OFFLINE_SOURCE_BACKUP, null, 2);
};
