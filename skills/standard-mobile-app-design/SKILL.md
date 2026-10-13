---
name: standard-mobile-app-design
description: "Standard 33 of the engineering standards library, scoped to platform-native UI IMPLEMENTATION in a React Native or Expo app. Covers when to go platform-specific versus unified, Material Design 3 and Apple HIG conventions, navigation patterns with Expo Router (stack, tabs, drawer, modal, bottom sheet), the typography and spacing token scales, per-platform touch target sizes, safe areas and the status bar, dark mode, haptic feedback, skeleton and loading patterns, gestures, app icon and splash requirements, and RTL support with I18nManager. It does not cover visual design craft (color, hierarchy, emotion, mockups): the `mobile-app-ui-design` skill owns that. Read it BEFORE building or changing any native mobile screen, tab bar, navigation structure, theme, or RTL layout, and when the user says \"Material Design\", \"HIG\", \"tab bar\", \"bottom sheet\", \"safe area\", \"notch\", \"dark mode in the app\", \"haptics\", \"skeleton loader\", \"splash screen\", \"app icon\", or \"RTL in React Native\"."
---

# Mobile App Design: platform-native UI implementation

**Scope and what lives elsewhere.** This skill is the engineering side of mobile UI: the
platform conventions and the code that implements them. Read these for the rest, do not look for
it here:

- `mobile-app-ui-design`: the visual and UX design process (the 60/30/10 color rule, type
  hierarchy, the 8-point grid, shadows, emotional design, smart patterns, anti-patterns). Read it
  first when designing a screen, then come here to build it natively.
- `mobile-view-optimization`: making a WEB app good on a phone. Not for native apps.
- `ui-ux-pro-max`: broader design intelligence and style choices.

## PHILOSOPHY
Mobile design is not web design on a smaller screen. Users expect platform-native patterns. An Android user expects Material Design. An iOS user expects Human Interface Guidelines. Respect the platform, share the design system tokens.

## 1. PLATFORM DESIGN LANGUAGES

### When to Go Platform-Specific vs Unified:

| Aspect | Unified (Same on Both) | Platform-Specific |
|--------|----------------------|-------------------|
| Colors, typography scale | Yes | No |
| Brand identity | Yes | No |
| Navigation structure | Mostly | Tab bar position differs |
| System controls | No | Yes (switches, pickers, alerts) |
| Transitions/animations | No | Yes (iOS slides, Android lifts) |
| Icons | Sometimes | Platform icon sets when possible |

### Material Design 3 (Android):
- Dynamic color based on wallpaper (Material You)
- Large touch targets (48dp minimum)
- Elevation and shadow hierarchy
- FAB (Floating Action Button) for primary actions
- Bottom navigation bar for top-level destinations
- Snackbar for brief feedback messages

### Human Interface Guidelines (iOS):
- SF Symbols for icons
- Large titles in navigation bars
- Tab bar at bottom (always visible)
- Action sheets for contextual choices
- Haptic feedback on interactions
- Pull-to-refresh with native spinner
- Swipe-to-go-back gesture

## 2. NAVIGATION PATTERNS

### Core Navigation Types:

| Pattern | When to Use | Expo Router Implementation |
|---------|-------------|--------------------------|
| **Stack** | Linear flows (detail pages, forms) | Nested route files |
| **Tabs** | Top-level sections (3-5 tabs) | app/(tabs)/_layout.tsx |
| **Drawer** | Secondary navigation, settings | app/(drawer)/_layout.tsx |
| **Modal** | Interrupting flows, forms, alerts | presentation: "modal" |
| **Bottom Sheet** | Contextual options, filters | @gorhom/bottom-sheet |

### Tab Layout Example:
```typescript
// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#2196F3",
        headerShown: Platform.OS !== "web",
        tabBarStyle: {
          height: Platform.select({ ios: 88, android: 64, web: 56 }),
          paddingBottom: Platform.select({ ios: 28, android: 8, web: 8 }),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
```

### Rules:
- Maximum 5 tabs. More than 5 is overwhelming.
- Tab bar is always visible on top-level screens.
- Stack navigation for drilling into detail from any tab.
- Modals for self-contained flows (creating, editing, confirming).
- Never nest more than 3 levels of stack navigation.

## 3. TYPOGRAPHY AND SPACING

### Typography Scale:
```typescript
export const typography = {
  displayLarge:  { fontSize: 57, lineHeight: 64, fontWeight: "400" },
  displayMedium: { fontSize: 45, lineHeight: 52, fontWeight: "400" },
  headlineLarge: { fontSize: 32, lineHeight: 40, fontWeight: "400" },
  headlineMedium:{ fontSize: 28, lineHeight: 36, fontWeight: "400" },
  titleLarge:    { fontSize: 22, lineHeight: 28, fontWeight: "500" },
  titleMedium:   { fontSize: 16, lineHeight: 24, fontWeight: "500" },
  bodyLarge:     { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  bodyMedium:    { fontSize: 14, lineHeight: 20, fontWeight: "400" },
  labelLarge:    { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  labelMedium:   { fontSize: 12, lineHeight: 16, fontWeight: "500" },
} as const;
```

### Spacing Scale:
```typescript
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;
```

Use consistent spacing tokens everywhere. No magic numbers in styles.

## 4. TOUCH TARGETS

### Minimum Sizes:

| Platform | Minimum Size | Recommended |
|----------|-------------|-------------|
| Android (Material) | 48dp x 48dp | 56dp for primary actions |
| iOS (HIG) | 44pt x 44pt | 44pt+ with adequate spacing |
| Web | 44px x 44px (WCAG) | Larger for primary CTAs |

```typescript
const styles = StyleSheet.create({
  touchTarget: {
    minHeight: Platform.select({ ios: 44, android: 48, web: 44 }),
    minWidth: Platform.select({ ios: 44, android: 48, web: 44 }),
    justifyContent: "center",
    alignItems: "center",
  },
});
```

Rule: If a user can miss the target with their finger, the target is too small. Non-negotiable.

## 5. SAFE AREAS AND STATUS BAR

### Safe Area Handling:
```typescript
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

export default function ScreenWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
      <StatusBar style="auto" />
      {children}
    </SafeAreaView>
  );
}
```

### Rules:
- Always use react-native-safe-area-context, never hardcode notch offsets
- Bottom safe area for tab bars and bottom buttons
- Status bar style should match header background
- Test on devices with notch, Dynamic Island, and no notch
- Test on devices with software navigation bar (Android)

## 6. DARK MODE

### Implementation:
```typescript
import { useColorScheme } from "react-native";

export const lightColors = {
  background: "#FFFFFF",
  surface: "#F5F5F5",
  text: "#1A1A1A",
  textSecondary: "#666666",
  primary: "#2196F3",
  border: "#E0E0E0",
};

export const darkColors = {
  background: "#121212",
  surface: "#1E1E1E",
  text: "#FFFFFF",
  textSecondary: "#B3B3B3",
  primary: "#64B5F6",
  border: "#333333",
};

export function useThemeColors() {
  const scheme = useColorScheme();
  return scheme === "dark" ? darkColors : lightColors;
}
```

### Rules:
- Respect system dark mode preference by default
- Allow manual override in app settings
- Dark mode is NOT just inverting colors. Design surfaces, elevation, and contrast intentionally.
- Test both modes. Ship both modes. No exceptions.

## 7. HAPTIC FEEDBACK

```typescript
import * as Haptics from "expo-haptics";

// Light - for selections, toggles
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

// Medium - for confirmations, snapping
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

// Heavy - for destructive actions, drops
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

// Success/Error - for form submission results
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
```

### When to Use:
- Toggle switches: Light impact
- Button press: Light impact
- Pull-to-refresh threshold: Medium impact
- Delete confirmation: Heavy impact or Error notification
- Successful save: Success notification
- NEVER on scroll, NEVER continuously, NEVER on every tap

## 8. LOADING AND SKELETON PATTERNS

### Skeleton Screens (Preferred Over Spinners):
```typescript
import { MotiView } from "moti";

function SkeletonLine({ width = "100%" }: { width?: string | number }) {
  return (
    <MotiView
      from={{ opacity: 0.3 }}
      animate={{ opacity: 1 }}
      transition={{ loop: true, duration: 1000, type: "timing" }}
      style={{
        height: 16,
        width,
        borderRadius: 4,
        backgroundColor: "#E0E0E0",
      }}
    />
  );
}
```

### Rules:
- Skeleton screens for initial page loads
- Inline spinners for button actions (replace button text with spinner)
- Pull-to-refresh for list refreshes (native pattern, do not custom-build)
- Never block the entire screen with a full-screen spinner unless absolutely necessary

## 9. GESTURES AND SWIPE ACTIONS

### Common Gesture Patterns:
- Pull-to-refresh on scrollable lists
- Swipe-to-delete or swipe-to-archive (with undo)
- Swipe-to-go-back (iOS native, do not disable)
- Long press for context menus
- Pinch-to-zoom on images

## 10. APP ICON AND SPLASH SCREEN

### Requirements:

| Asset | Android | iOS | Web |
|-------|---------|-----|-----|
| App Icon | 1024x1024 (adaptive: foreground + background) | 1024x1024 (no transparency) | 512x512 favicon + PWA icons |
| Splash Screen | Configured via expo-splash-screen | Configured via expo-splash-screen | HTML loading screen |

### Rules:
- App icon must be recognizable at 24x24 pixels
- No text in the app icon (unreadable at small sizes)
- Splash screen should match app background color for seamless transition
- Use expo-splash-screen to control when splash hides (after data loads)

## 11. RTL SUPPORT (HEBREW, ARABIC, AND OTHER RTL LANGUAGES)

### Enabling RTL:
```typescript
// app/_layout.tsx
import { I18nManager } from "react-native";

const RTL_LOCALES = ["he", "ar", "fa", "ur"];

if (RTL_LOCALES.includes(currentLocale)) {
  I18nManager.forceRTL(true);
  I18nManager.allowRTL(true);
}
```

### RTL-Safe Styles:
```typescript
const styles = StyleSheet.create({
  row: {
    flexDirection: "row", // Automatically flips in RTL
  },
  text: {
    textAlign: "auto",    // Respects RTL direction
    writingDirection: "auto",
  },
  icon: {
    transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }],
  },
});
```

### Rules:
- Flexbox row direction flips automatically in RTL mode
- Use I18nManager.isRTL to flip directional icons (arrows, chevrons)
- Test every screen in both LTR and RTL
- Use textAlign "auto" instead of "left" or "right"
- Use marginStart/marginEnd instead of marginLeft/marginRight

## IMPLEMENTATION REQUIREMENT
Every screen must work on Android, iOS, and Web. Every screen must support dark mode. Every screen must support RTL layout. Touch targets must meet minimum size requirements. Test on real devices, not just simulators. Simulators lie about touch precision and performance.

## RELATED SKILLS

- `mobile-app-ui-design`: visual design craft for mobile screens.
- `standard-internationalization`: translation files, formatting, RTL on the web.
- `standard-design-system`: the shared design tokens.
- `standard-accessibility-wcag`: contrast, focus, screen readers.
- `standard-native-device-apis`: the haptics API in full.
