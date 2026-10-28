// The Linux binary is a hosted policy probe, never a source-build launcher.
package main

import (
	"encoding/json"
	"os"
	"runtime"
	"syscall"
)

const queryMask uint64 = 0xffffffff
const approvedMask uint64 = 268173312               // 0x0ffc0000, exact upstream setarch test.
const minusMask uint64 = approvedMask &^ 0x00040000 // Remove ADDR_NO_RANDOMIZE.
const plusMask uint64 = approvedMask | 0x10000000   // Additional, unapproved bit.

type personalityCall func(uint64) (uint64, syscall.Errno)
type Check struct {
	Mask  uint64 `json:"mask"`
	Errno uint64 `json:"errno"`
}
type Result struct {
	Mode    string  `json:"mode"`
	Passed  bool    `json:"passed"`
	Calls   int     `json:"calls"`
	Checks  []Check `json:"checks"`
	Failure string  `json:"failure,omitempty"`
}

func run(mode string, call personalityCall) Result {
	result := Result{Mode: mode, Checks: make([]Check, 0, 6)}
	if mode != "baseline" && mode != "bounded" {
		result.Mode = "invalid"
		result.Failure = "invalid-mode"
		return result
	}
	invoke := func(mask uint64) (uint64, syscall.Errno) {
		value, errno := call(mask)
		result.Calls++
		result.Checks = append(result.Checks, Check{mask, uint64(errno)})
		return value, errno
	}
	original, errno := invoke(queryMask)
	if errno != 0 {
		result.Failure = "initial-query-failed"
		return result
	}
	if original != 0 {
		result.Failure = "initial-personality-not-zero"
		return result
	}
	previous, errno := invoke(approvedMask)
	if mode == "baseline" {
		if errno != syscall.EPERM {
			if errno == 0 {
				_, restore := invoke(original)
				if restore != 0 {
					result.Failure = "restore-failed"
					return result
				}
			}
			result.Failure = "baseline-mask-not-denied-eperm"
			return result
		}
	} else {
		if errno != 0 {
			result.Failure = "bounded-mask-not-allowed"
			return result
		}
		// Restore before any controls or return, even if the previous value differed.
		active, restore := invoke(original)
		if restore != 0 {
			result.Failure = "restore-failed"
			return result
		}
		if previous != original || active != approvedMask {
			result.Failure = "unexpected-personality-result"
			return result
		}
	}
	for _, mask := range []uint64{minusMask, plusMask} {
		_, errno = invoke(mask)
		if errno != syscall.EPERM {
			if errno == 0 {
				_, restore := invoke(original)
				if restore != 0 {
					result.Failure = "restore-failed"
					return result
				}
			}
			result.Failure = "control-mask-not-denied-eperm"
			return result
		}
	}
	result.Passed = true
	return result
}
func main() {
	mode := "invalid"
	if len(os.Args) == 2 && (os.Args[1] == "baseline" || os.Args[1] == "bounded") {
		mode = os.Args[1]
	}
	// Personality is per-thread; all calls and restoration must use one OS thread.
	runtime.LockOSThread()
	result := run(mode, platformPersonality)
	encoded, err := json.Marshal(result)
	if err != nil {
		os.Exit(1)
	}
	os.Stdout.Write(append(encoded, '\n'))
	if !result.Passed {
		os.Exit(1)
	}
}
