#import <AVFoundation/AVFoundation.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreFoundation/CoreFoundation.h>
#import <CoreAudio/CoreAudio.h>

int mim_mic_permission_status(void) {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    return (int)status;
}

typedef void (*MimPermissionCallback)(int status);

void mim_request_mic_permission(MimPermissionCallback callback) {
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
        if (callback) {
            callback(granted ? 3 : 2);
        }
    }];
}

int mim_accessibility_status(void) {
    return AXIsProcessTrusted() ? 1 : 0;
}

int mim_request_accessibility_permission(void) {
    const void *keys[] = { kAXTrustedCheckOptionPrompt };
    const void *values[] = { kCFBooleanTrue };
    CFDictionaryRef options = CFDictionaryCreate(
        kCFAllocatorDefault,
        keys,
        values,
        1,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks
    );

    Boolean trusted = AXIsProcessTrustedWithOptions(options);
    if (options) {
        CFRelease(options);
    }
    return trusted ? 1 : 0;
}

int mim_input_monitoring_status(void) {
    return CGPreflightListenEventAccess() ? 1 : 0;
}

int mim_request_input_monitoring_permission(void) {
    return CGRequestListenEventAccess() ? 1 : 0;
}

static AudioObjectID mim_default_output_device(void) {
    AudioObjectID device = kAudioObjectUnknown;
    UInt32 size = sizeof(device);
    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &size, &device);
    return device;
}

int mim_get_system_mute(void) {
    AudioObjectID device = mim_default_output_device();
    if (device == kAudioObjectUnknown) return -1;

    AudioObjectPropertyAddress addr = {
        kAudioDevicePropertyMute,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    };
    UInt32 muted = 0;
    UInt32 size = sizeof(muted);
    if (AudioObjectGetPropertyData(device, &addr, 0, NULL, &size, &muted) != 0) return -1;
    return (int)muted;
}

int mim_set_system_mute(int mute) {
    AudioObjectID device = mim_default_output_device();
    if (device == kAudioObjectUnknown) return -1;

    AudioObjectPropertyAddress addr = {
        kAudioDevicePropertyMute,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    };
    UInt32 muted = (UInt32)mute;
    if (AudioObjectSetPropertyData(device, &addr, 0, NULL, sizeof(muted), &muted) != 0) return -1;
    return 0;
}
