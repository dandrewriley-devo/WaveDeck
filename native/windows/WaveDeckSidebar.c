#define UNICODE
#define _UNICODE
#define WINVER 0x0601
#define _WIN32_WINNT 0x0601
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

#define APPBAR_CALLBACK (WM_APP + 41)
#define TIMER_WINDOW_CHECK 1

static HWND target_window = NULL;
static HWND helper_window = NULL;
static int logical_width = 300;
static BOOL registered_appbar = FALSE;
static BOOL positioning = FALSE;
static UINT taskbar_created_message = 0;
static RECT current_rect = {0};

static void enable_per_monitor_dpi_awareness(void) {
  typedef BOOL (WINAPI *SetProcessDpiAwarenessContextFn)(HANDLE);
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  SetProcessDpiAwarenessContextFn set_awareness = user32
    ? (SetProcessDpiAwarenessContextFn)(void *)GetProcAddress(user32, "SetProcessDpiAwarenessContext")
    : NULL;
  if (set_awareness) set_awareness((HANDLE)(LONG_PTR)-4);
  else SetProcessDPIAware();
}

static UINT window_dpi(HWND hwnd) {
  typedef UINT (WINAPI *GetDpiForWindowFn)(HWND);
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  GetDpiForWindowFn get_dpi = user32
    ? (GetDpiForWindowFn)(void *)GetProcAddress(user32, "GetDpiForWindow")
    : NULL;
  if (get_dpi) {
    UINT dpi = get_dpi(hwnd);
    if (dpi > 0) return dpi;
  }
  return 96;
}

static void remove_appbar(void) {
  if (!registered_appbar || !helper_window) return;
  APPBARDATA data;
  ZeroMemory(&data, sizeof(data));
  data.cbSize = sizeof(data);
  data.hWnd = helper_window;
  SHAppBarMessage(ABM_REMOVE, &data);
  registered_appbar = FALSE;
}

static BOOL register_appbar(void) {
  if (!IsWindow(target_window) || !IsWindow(helper_window)) return FALSE;
  if (registered_appbar) return TRUE;
  APPBARDATA data;
  ZeroMemory(&data, sizeof(data));
  data.cbSize = sizeof(data);
  data.hWnd = helper_window;
  data.uCallbackMessage = APPBAR_CALLBACK;
  registered_appbar = SHAppBarMessage(ABM_NEW, &data) != 0;
  return registered_appbar;
}

static BOOL position_appbar(void) {
  if (positioning || !IsWindow(target_window)) return FALSE;
  positioning = TRUE;

  if (!register_appbar()) {
    positioning = FALSE;
    return FALSE;
  }

  HMONITOR monitor = MonitorFromWindow(target_window, MONITOR_DEFAULTTONEAREST);
  MONITORINFO monitor_info;
  ZeroMemory(&monitor_info, sizeof(monitor_info));
  monitor_info.cbSize = sizeof(monitor_info);
  if (!GetMonitorInfoW(monitor, &monitor_info)) {
    positioning = FALSE;
    return FALSE;
  }

  UINT dpi = window_dpi(target_window);
  int width_pixels = MulDiv(logical_width, (int)dpi, 96);
  if (width_pixels < 200) width_pixels = 200;
  if (width_pixels > monitor_info.rcMonitor.right - monitor_info.rcMonitor.left) {
    width_pixels = monitor_info.rcMonitor.right - monitor_info.rcMonitor.left;
  }

  APPBARDATA data;
  ZeroMemory(&data, sizeof(data));
  data.cbSize = sizeof(data);
  data.hWnd = helper_window;
  data.uEdge = ABE_RIGHT;
  data.rc = monitor_info.rcMonitor;
  data.rc.left = data.rc.right - width_pixels;

  SHAppBarMessage(ABM_QUERYPOS, &data);
  data.rc.left = data.rc.right - width_pixels;
  SHAppBarMessage(ABM_SETPOS, &data);
  current_rect = data.rc;

  MoveWindow(
    helper_window,
    data.rc.left,
    data.rc.top,
    data.rc.right - data.rc.left,
    data.rc.bottom - data.rc.top,
    TRUE
  );
  BOOL moved = SetWindowPos(
    target_window,
    HWND_TOPMOST,
    data.rc.left,
    data.rc.top,
    data.rc.right - data.rc.left,
    data.rc.bottom - data.rc.top,
    SWP_NOACTIVATE | SWP_SHOWWINDOW
  );
  positioning = FALSE;
  return moved;
}

static LRESULT CALLBACK helper_window_proc(HWND hwnd, UINT message, WPARAM w_param, LPARAM l_param) {
  if (message == taskbar_created_message) {
    registered_appbar = FALSE;
    position_appbar();
    return 0;
  }
  if (message == APPBAR_CALLBACK) {
    switch (w_param) {
      case ABN_POSCHANGED:
        position_appbar();
        return 0;
      case ABN_FULLSCREENAPP:
        SetWindowPos(
          target_window,
          l_param ? HWND_BOTTOM : HWND_TOPMOST,
          0, 0, 0, 0,
          SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
        );
        return 0;
      default:
        return 0;
    }
  }
  switch (message) {
    case WM_DISPLAYCHANGE:
    case WM_DPICHANGED:
    case WM_SETTINGCHANGE:
      position_appbar();
      return 0;
    case WM_TIMER:
      if (w_param == TIMER_WINDOW_CHECK && !IsWindow(target_window)) DestroyWindow(hwnd);
      return 0;
    case WM_ACTIVATE: {
      APPBARDATA data;
      ZeroMemory(&data, sizeof(data));
      data.cbSize = sizeof(data);
      data.hWnd = helper_window;
      data.lParam = LOWORD(w_param) != WA_INACTIVE;
      SHAppBarMessage(ABM_ACTIVATE, &data);
      return 0;
    }
    case WM_WINDOWPOSCHANGED: {
      APPBARDATA data;
      ZeroMemory(&data, sizeof(data));
      data.cbSize = sizeof(data);
      data.hWnd = helper_window;
      SHAppBarMessage(ABM_WINDOWPOSCHANGED, &data);
      return DefWindowProcW(hwnd, message, w_param, l_param);
    }
    case WM_NCHITTEST:
      return HTTRANSPARENT;
    case WM_CLOSE:
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      remove_appbar();
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcW(hwnd, message, w_param, l_param);
  }
}

static DWORD WINAPI watch_input_and_close_helper(LPVOID helper_window_value) {
  HWND helper_handle = (HWND)helper_window_value;
  char buffer[32];
  DWORD bytes_read = 0;
  while (ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer, sizeof(buffer), &bytes_read, NULL) && bytes_read > 0) {
    for (DWORD index = 0; index < bytes_read; ++index) {
      if (buffer[index] == '\n' || buffer[index] == '\r') {
        PostMessageW(helper_handle, WM_CLOSE, 0, 0);
        return 0;
      }
    }
  }
  PostMessageW(helper_handle, WM_CLOSE, 0, 0);
  return 0;
}

int wmain(int argc, wchar_t **argv) {
  enable_per_monitor_dpi_awareness();
  if (argc != 3) {
    fwprintf(stderr, L"WaveDeck Sidebar requires a window handle and width.\n");
    return 2;
  }

  wchar_t *handle_end = NULL;
  unsigned long long raw_handle = wcstoull(argv[1], &handle_end, 10);
  long requested_width = wcstol(argv[2], NULL, 10);
  if (!raw_handle || !handle_end || *handle_end != L'\0' || requested_width < 200 || requested_width > 2000) {
    fwprintf(stderr, L"WaveDeck Sidebar received invalid window information.\n");
    return 2;
  }
  target_window = (HWND)(uintptr_t)raw_handle;
  logical_width = (int)requested_width;
  if (!IsWindow(target_window)) {
    fwprintf(stderr, L"WaveDeck Sidebar could not find the player window.\n");
    return 3;
  }

  const wchar_t *class_name = L"WaveDeckSidebarHelperWindow";
  WNDCLASSEXW window_class;
  ZeroMemory(&window_class, sizeof(window_class));
  window_class.cbSize = sizeof(window_class);
  window_class.lpfnWndProc = helper_window_proc;
  window_class.hInstance = GetModuleHandleW(NULL);
  window_class.lpszClassName = class_name;
  if (!RegisterClassExW(&window_class) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    fwprintf(stderr, L"WaveDeck Sidebar could not register its helper window.\n");
    return 4;
  }

  helper_window = CreateWindowExW(
    WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT,
    class_name,
    L"WaveDeck Sidebar Helper",
    WS_POPUP,
    0, 0, 0, 0,
    NULL, NULL, window_class.hInstance, NULL
  );
  if (!helper_window) {
    fwprintf(stderr, L"WaveDeck Sidebar could not create its helper window.\n");
    return 4;
  }
  SetLayeredWindowAttributes(helper_window, 0, 0, LWA_ALPHA);

  taskbar_created_message = RegisterWindowMessageW(L"TaskbarCreated");
  SetTimer(helper_window, TIMER_WINDOW_CHECK, 1000, NULL);
  if (!position_appbar()) {
    fwprintf(stdout, L"ERROR|Windows rejected the desktop reservation.\n");
    fflush(stdout);
    DestroyWindow(helper_window);
    return 5;
  }
  ShowWindow(helper_window, SW_SHOWNOACTIVATE);

  HANDLE input_thread = CreateThread(NULL, 0, watch_input_and_close_helper, helper_window, 0, NULL);
  if (!input_thread) {
    fwprintf(stdout, L"ERROR|Windows could not start the Sidebar cleanup monitor.\n");
    fflush(stdout);
    DestroyWindow(helper_window);
    return 6;
  }
  CloseHandle(input_thread);

  fwprintf(
    stdout,
    L"READY|%ld|%ld|%ld|%ld\n",
    current_rect.left,
    current_rect.top,
    current_rect.right - current_rect.left,
    current_rect.bottom - current_rect.top
  );
  fflush(stdout);

  MSG message;
  while (GetMessageW(&message, NULL, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  remove_appbar();
  return 0;
}
