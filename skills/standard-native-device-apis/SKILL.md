---
name: standard-native-device-apis
description: "Standard 36 of the engineering standards library: using native device capabilities in a React Native or Expo app. Covers the permissions model (check, explain, request, handle denial), camera and media picking, location services (foreground, background, accuracy), biometric authentication, secure storage versus plain storage, the file system, sharing, haptics, audio and video, and local notifications with Android channels. Read it BEFORE requesting any device permission or touching the camera, photo library, location, Face ID or fingerprint, secure storage, files, the share sheet, haptics, audio, video, or local notifications, and when the user says \"permission prompt\", \"camera\", \"image picker\", \"location\", \"GPS\", \"Face ID\", \"biometrics\", \"SecureStore\", \"Keychain\", \"file system\", \"share sheet\", \"haptics\", or \"local notification\"."
---

# Native Device APIs: camera, location, biometrics, storage

## PHILOSOPHY
Native APIs are what make an app feel like an app, not a website in a wrapper. Camera, biometrics, haptics, location: these are the features users expect. But every native API requires permissions, graceful fallbacks, and respect for the user's choices.

## 1. PERMISSIONS MODEL

### The Golden Rule:
Ask for permissions ONLY when the user is about to use the feature. Never on app launch. Never in a batch.

### Permission Flow:
```typescript
import * as ImagePicker from 'expo-image-picker';

async function pickImage() {
  // 1. Check current status
  const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();

  if (status === 'granted') {
    return launchPicker(); // Already granted
  }

  // 2. Request with context (user just tapped "Add Photo")
  const { status: newStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (newStatus === 'granted') {
    return launchPicker();
  }

  // 3. Denied: show explanation and link to settings
  Alert.alert(
    'Photo Access Required',
    'To add photos to your status, please enable photo access in Settings.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]
  );
}
```

### Rules:
- NEVER request all permissions on first launch
- Request in context: camera permission when user taps camera button
- Handle "denied" gracefully: explain why you need it, offer settings link
- Handle "never_ask_again" on Android: can only go to settings
- Check permission status before every use (user can revoke anytime)
- Degrade gracefully: if no camera permission, offer file picker instead

## 2. CAMERA AND MEDIA

### Camera:
```typescript
import { CameraView, useCameraPermissions } from 'expo-camera';

function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const takePicture = async () => {
    const photo = await cameraRef.current?.takePictureAsync({
      quality: 0.8,
      base64: false,
    });
    // photo.uri is the local file path
  };

  return <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />;
}
```

### Image Picker:
```typescript
import * as ImagePicker from 'expo-image-picker';

const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ['images', 'videos'],
  allowsEditing: true,
  aspect: [1, 1],       // Square crop
  quality: 0.8,
  videoMaxDuration: 60,  // Seconds
});

if (!result.canceled) {
  const asset = result.assets[0];
  // asset.uri, asset.width, asset.height, asset.type
}
```

### Image Compression:
```typescript
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const compressed = await manipulateAsync(
  originalUri,
  [{ resize: { width: 1080 } }],  // Resize to max 1080px wide
  { compress: 0.7, format: SaveFormat.JPEG }
);
// compressed.uri is ready for upload
```

## 3. LOCATION SERVICES

### Foreground Location:
```typescript
import * as Location from 'expo-location';

const { status } = await Location.requestForegroundPermissionsAsync();
if (status !== 'granted') return;

const location = await Location.getCurrentPositionAsync({
  accuracy: Location.Accuracy.Balanced,
});
// location.coords.latitude, location.coords.longitude
```

### Background Location (use sparingly):
```typescript
// Requires: expo-location + expo-task-manager
// AND user must grant "Always" location permission
import * as TaskManager from 'expo-task-manager';

TaskManager.defineTask('BACKGROUND_LOCATION', ({ data, error }) => {
  if (error) return;
  const { locations } = data;
  // Process location updates in background
});

await Location.startLocationUpdatesAsync('BACKGROUND_LOCATION', {
  accuracy: Location.Accuracy.Balanced,
  distanceInterval: 100,  // Meters between updates
  showsBackgroundLocationIndicator: true,  // iOS blue bar
});
```

### Rules:
- Use foreground location only unless background is essential
- Background location requires strong justification (Apple will reject without it)
- Show the user WHY you need their location before requesting
- Cache last known location for quick display
- Handle location errors (GPS disabled, no permission)

## 4. BIOMETRIC AUTHENTICATION

```typescript
import * as LocalAuthentication from 'expo-local-authentication';

// Check device capabilities
const compatible = await LocalAuthentication.hasHardwareAsync();
const enrolled = await LocalAuthentication.isEnrolledAsync();
const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
// Types: FINGERPRINT, FACIAL_RECOGNITION, IRIS

// Authenticate
const result = await LocalAuthentication.authenticateAsync({
  promptMessage: 'Verify your identity',
  cancelLabel: 'Use Password',
  disableDeviceFallback: false,  // Allow PIN/password fallback
});

if (result.success) {
  // Authenticated
}
```

### Rules:
- Biometric is convenience, not primary auth. Always offer password fallback.
- Check `hasHardwareAsync` AND `isEnrolledAsync` before offering biometric
- Use for: app unlock, sensitive actions (payment, delete account)
- Store a flag in SecureStore whether user opted into biometric unlock

## 5. SECURE STORAGE

```typescript
import * as SecureStore from 'expo-secure-store';

// Store (encrypted: Keychain on iOS, EncryptedSharedPreferences on Android)
await SecureStore.setItemAsync('auth_token', token);
await SecureStore.setItemAsync('refresh_token', refreshToken);

// Retrieve
const token = await SecureStore.getItemAsync('auth_token');

// Delete
await SecureStore.deleteItemAsync('auth_token');
```

### What Goes in SecureStore:
- Auth tokens (access + refresh)
- API keys (if stored client-side)
- Encryption keys
- Biometric authentication flags

### What Does NOT Go in SecureStore:
- User preferences (use MMKV or AsyncStorage)
- Cached data (use SQLite or file system)
- Large blobs (2KB limit per item on some platforms)

## 6. FILE SYSTEM

```typescript
import * as FileSystem from 'expo-file-system';

// App's document directory (persists across updates)
const docDir = FileSystem.documentDirectory;

// App's cache directory (OS can clear when low on space)
const cacheDir = FileSystem.cacheDirectory;

// Download a file
const download = await FileSystem.downloadAsync(
  'https://example.com/image.jpg',
  `${cacheDir}image.jpg`
);

// Read file info
const info = await FileSystem.getInfoAsync(download.uri);
// info.size, info.exists, info.modificationTime

// Delete file
await FileSystem.deleteAsync(download.uri, { idempotent: true });
```

### Rules:
- Cache media in cacheDirectory (OS manages cleanup)
- Store user data in documentDirectory (persists)
- Clean up temp files after processing
- Check available disk space before large downloads
- Use `FileSystem.downloadAsync` for large files (shows progress)

## 7. SHARING

```typescript
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

// Share text/URL (system share sheet)
await Share.share({
  message: 'Check out this status!',
  url: 'https://yourapp.com/status/123',  // iOS only for separate URL
  title: 'My App',
});

// Share a file
const isAvailable = await Sharing.isAvailableAsync();
if (isAvailable) {
  await Sharing.shareAsync(fileUri, {
    mimeType: 'image/jpeg',
    dialogTitle: 'Share this status',
  });
}
```

## 8. HAPTICS

```typescript
import * as Haptics from 'expo-haptics';

// Impact feedback (physical tap sensation)
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);   // Button tap
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // Toggle, selection
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);   // Significant action

// Notification feedback (success/warning/error)
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);  // Saved!
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);  // Careful...
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);    // Failed!

// Selection feedback (scrolling through picker)
Haptics.selectionAsync();
```

### Rules:
- Use sparingly: haptics enhance UX, overuse annoys users
- Always pair with visual feedback (haptic alone is not enough)
- No haptics on web (check Platform.OS before calling)
- No haptics on continuous scroll (only on snap points)

## 9. AUDIO AND VIDEO

```typescript
import { Audio, Video } from 'expo-av';

// Play audio
const { sound } = await Audio.Sound.createAsync(
  { uri: 'https://example.com/audio.mp3' },
  { shouldPlay: true }
);

// Audio session configuration (important for background playback)
await Audio.setAudioModeAsync({
  playsInSilentModeIOS: true,
  staysActiveInBackground: true,
  shouldDuckAndroid: true,
});

// Video component
<Video
  source={{ uri: 'https://example.com/video.mp4' }}
  style={{ width: '100%', aspectRatio: 16 / 9 }}
  useNativeControls
  resizeMode="contain"
  shouldPlay={isVisible}
/>
```

## 10. NOTIFICATIONS (LOCAL)

```typescript
import * as Notifications from 'expo-notifications';

// Schedule a local notification
await Notifications.scheduleNotificationAsync({
  content: {
    title: 'New status available',
    body: 'Check out what is new today',
    data: { statusId: '123' },
    sound: true,
    badge: 1,
  },
  trigger: {
    seconds: 60 * 60,  // 1 hour from now
  },
});

// Cancel all scheduled notifications
await Notifications.cancelAllScheduledNotificationsAsync();

// Set badge count
await Notifications.setBadgeCountAsync(0);
```

### Android Notification Channels:
```typescript
// Required on Android 8+
await Notifications.setNotificationChannelAsync('statuses', {
  name: 'New Statuses',
  importance: Notifications.AndroidImportance.HIGH,
  vibrationPattern: [0, 250, 250, 250],
  lightColor: '#2563EB',
});

await Notifications.setNotificationChannelAsync('messages', {
  name: 'Messages',
  importance: Notifications.AndroidImportance.MAX,
  sound: 'default',
});
```

## IMPLEMENTATION REQUIREMENT
Every native API call checks permissions first. Every permission request happens in context. Every feature degrades gracefully when permission is denied. Sensitive data uses SecureStore. Media uses proper compression before upload. The app never crashes from a missing permission or unavailable hardware.

## RELATED SKILLS

- `apple-app-store-submission`: purpose strings and the privacy rules Apple enforces on permissions.
- `standard-mobile-app-architecture`: push notifications and the auth flow.
- `standard-audit-ready-code`: mobile data storage requirements (OWASP MASVS).
- `standard-mobile-app-design`: when to use haptics.
