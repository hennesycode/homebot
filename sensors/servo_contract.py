"""Nominal SG90 command range; actual shaft travel needs physical calibration."""
MIN_ANGLE = 0
MAX_ANGLE = 180
MIN_PULSE_US = 1000
MAX_PULSE_US = 2000


def valid_angle(angle):
    return type(angle) is int and MIN_ANGLE <= angle <= MAX_ANGLE


def supports_full_range(payload):
    return payload.get('servo_min_angle') == 0 and payload.get('servo_max_angle') == 180


def servo_state(state, legacy=False):
    angle = state.get('angle')
    lo, hi, pmin, pmax = (45,135,1100,1900) if legacy else (MIN_ANGLE,MAX_ANGLE,MIN_PULSE_US,MAX_PULSE_US)
    pulse = pmin + ((angle-lo)*(pmax-pmin)+(0 if legacy else 90))//(hi-lo) if valid_angle(angle) and lo<=angle<=hi else None
    return {**state, 'min_angle': lo, 'max_angle': hi,
            'min_pulse_us': pmin, 'max_pulse_us': pmax, 'legacy_firmware': legacy,
            'pulse_us': pulse, 'position_feedback': False}
