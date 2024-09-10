import { capturePosthogEvent, identifyPosthogUser, setPosthogGlobalProperties, startPosthog, stopPosthog } from "./posthog"
import { captureCustomEvent, setGlobalCustomEventProperties, startCustomEventCapture, stopCustomEventCapture } from "./custom"

export const GLOBAL_EVENTS = {
    "email_entered": "global/email_entered",
    "otp_received": "global/otp_received",
    "otp_sending_failed": "global/otp_sending_failed",
    "email_reset": "global/email_reset",
    "otp_attempted": "global/otp_attempted",
    "otp_failed": "global/otp_failed",
    "otp_success": "global/success",
}

export const captureEvent = (type: string, payload?: object) => {
    capturePosthogEvent(type, payload)
    captureCustomEvent(type, payload)
}

export const identifyUser = (profile_id: string, kv?: Record<string, string>) => {
    identifyPosthogUser(profile_id, kv)
}

export const setGlobalProperies = (kv: Record<string, string>) => {
    setGlobalCustomEventProperties(kv)
    setPosthogGlobalProperties(kv)
}

export const stopEventCapture = () => {
    stopPosthog()
    stopCustomEventCapture()
}

export const startEventCapture = () => {
    startPosthog()
    startCustomEventCapture()
}