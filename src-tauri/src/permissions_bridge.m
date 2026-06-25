#import <AVFoundation/AVFoundation.h>
#import <ApplicationServices/ApplicationServices.h>

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
