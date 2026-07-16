import { BrowserWindow } from 'electron';
import { getSupabaseClient } from './sync/supabase-client';
import { app } from 'electron';
import * as semver from 'semver';
import log from 'electron-log';

export async function checkAppVersionEnforcement(mainWindow: BrowserWindow) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      log.warn('[Enforcer] Supabase client not initialized, skipping version check.');
      return;
    }

    const { data, error } = await supabase
      .from('t_app_version')
      .select('min_version, latest_version, release_notes')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      log.warn('[Enforcer] Unable to fetch app version from Supabase:', error);
      return;
    }

    const currentVersion = app.getVersion();
    const minVersion = data.min_version;

    if (semver.lt(currentVersion, minVersion)) {
      log.warn(`[Enforcer] Current version ${currentVersion} is less than min_version ${minVersion}. Forcing update.`);
      mainWindow.webContents.send('enforcer:update-required', {
        currentVersion,
        minVersion,
        latestVersion: data.latest_version,
        releaseNotes: data.release_notes
      });
    } else {
      log.info(`[Enforcer] Version ${currentVersion} is compliant with min_version ${minVersion}.`);
    }
  } catch (err) {
    log.error('[Enforcer] Error during version check:', err);
  }
}

