import { db } from '../db';

/**
 * Dynamically loads the Google Identity Services JS client.
 */
export function loadGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const id = 'google-gsi-client-script';
    let script = document.getElementById(id) as HTMLScriptElement;
    if (!script) {
      script = document.createElement('script');
      script.id = id;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = (e) => reject(new Error('Failed to load Google Identity Services library.'));
      document.head.appendChild(script);
    } else {
      script.addEventListener('load', () => resolve());
    }
  });
}

/**
 * Initiates the Google GIS implicit token flow to request access token for Drive access.
 */
export async function requestDriveAccessToken(clientId: string): Promise<string> {
  await loadGsiScript();
  return new Promise((resolve, reject) => {
    try {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
        callback: (tokenResponse: any) => {
          if (tokenResponse.error_code) {
            reject(new Error(tokenResponse.error_description || 'OAuth token request failed.'));
            return;
          }
          if (tokenResponse.access_token) {
            resolve(tokenResponse.access_token);
          } else {
            reject(new Error('No access token returned from Google.'));
          }
        },
        error_callback: (err: any) => {
          reject(err);
        }
      });
      client.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      reject(err);
    }
  });
}

export interface DriveBackupFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
}

/**
 * Lists backups in Google Drive that have the PickUrVeggie signature metadata name.
 */
export async function listDriveBackups(accessToken: string): Promise<DriveBackupFile[]> {
  const query = encodeURIComponent("name contains 'pickurveggie_backup' and mimeType = 'application/json' and trashed = false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,createdTime,size)&orderBy=createdTime desc`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Drive list failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Uploads a JSON backup payload to Google Drive.
 */
export async function uploadBackupToDrive(
  accessToken: string,
  payload: any,
  fileName: string
): Promise<DriveBackupFile> {
  const fileContent = JSON.stringify(payload, null, 2);
  const fileBlob = new Blob([fileContent], { type: 'application/json' });

  // Google Drive multipart upload requires mixing file metadata and actual file content
  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    description: 'PickUrVeggie ERP Local Database Backup'
  };

  const multipartBoundary = 'pick_ur_veggie_boundary_99212';
  const delimiter = `\n--${multipartBoundary}\n`;
  const closeDelimiter = `\n--${multipartBoundary}--`;

  const reader = new FileReader();
  const fileDataPromise = new Promise<string>((resolve) => {
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.readAsBinaryString(fileBlob);
  });

  const fileData = await fileDataPromise;

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\n\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\n' +
    'Content-Transfer-Encoding: base64\n\n' +
    btoa(fileData) +
    closeDelimiter;

  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,createdTime';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${multipartBoundary}`
    },
    body: body
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Drive upload failed: ${response.status} - ${errorBody}`);
  }

  return await response.json();
}

/**
 * Downloads a backup file payload from Google Drive.
 */
export async function downloadBackupFromDrive(accessToken: string, fileId: string): Promise<any> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Drive download failed: ${response.status} - ${errorBody}`);
  }

  return await response.json();
}
