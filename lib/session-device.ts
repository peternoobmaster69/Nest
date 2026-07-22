function browserName(userAgent: string) {
  if (/EdgA?\//.test(userAgent)) return "Edge";
  if (/FxiOS\//.test(userAgent) || /Firefox\//.test(userAgent)) return "Firefox";
  if (/CriOS\//.test(userAgent) || /Chrome\//.test(userAgent)) return "Chrome";
  if (/OPR\//.test(userAgent)) return "Opera";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Browser";
}

function formatDevice(device: string, userAgent: string) {
  return `${device} · ${browserName(userAgent)}`;
}

export function describeClientDevice(
  userAgent: string,
  maxTouchPoints: number,
  screenWidth: number,
  screenHeight: number,
) {
  const appleTouchDevice = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  const shortestScreenSide = Math.min(screenWidth, screenHeight);
  if (/iPhone|iPod/.test(userAgent) || (appleTouchDevice && shortestScreenSide < 600)) {
    return formatDevice("iPhone", userAgent);
  }
  if (/iPad/.test(userAgent) || (appleTouchDevice && shortestScreenSide >= 600)) {
    return formatDevice("iPad", userAgent);
  }
  return describeSessionDevice(userAgent);
}

export function describeSessionDevice(userAgent: string | null | undefined) {
  if (!userAgent) return "Unknown device";

  let device = "Unknown device";
  if (/iPhone|iPod/.test(userAgent)) {
    device = "iPhone";
  } else if (/iPad/.test(userAgent)) {
    device = "iPad";
  } else if (/Android/.test(userAgent)) {
    device = /Mobile/.test(userAgent) ? "Android phone" : "Android tablet";
  } else if (/Macintosh/.test(userAgent) && /Mobile\//.test(userAgent)) {
    // Apple desktop-mode user agents do not reliably distinguish iPhone from iPad.
    device = "Apple mobile device";
  } else if (/Windows/.test(userAgent)) {
    device = "Windows PC";
  } else if (/CrOS/.test(userAgent)) {
    device = "Chromebook";
  } else if (/Macintosh|Mac OS X/.test(userAgent)) {
    device = "Mac";
  } else if (/Linux/.test(userAgent)) {
    device = "Linux device";
  }

  return formatDevice(device, userAgent);
}
