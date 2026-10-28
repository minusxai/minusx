package main

import (
	"encoding/json"
	"strings"
	"syscall"
	"testing"
)

type answer struct {
	mask, value uint64
	errno       syscall.Errno
}

func sequence(t *testing.T, expected []answer) personalityCall {
	t.Helper()
	index := 0
	t.Cleanup(func() {
		if index != len(expected) {
			t.Error("not all expected calls occurred")
		}
	})
	return func(mask uint64) (uint64, syscall.Errno) {
		if index >= len(expected) {
			t.Fatal("unexpected extra syscall")
		}
		a := expected[index]
		index++
		if mask != a.mask {
			t.Fatal("unexpected syscall mask/order")
		}
		return a.value, a.errno
	}
}
func TestBaseline(t *testing.T) {
	r := run("baseline", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, syscall.EPERM}, {minusMask, 0, syscall.EPERM}, {plusMask, 0, syscall.EPERM}}))
	if !r.Passed || r.Calls != 4 {
		t.Fatal("baseline failed")
	}
}
func TestBoundedRestoresBeforeControls(t *testing.T) {
	r := run("bounded", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, 0}, {0, approvedMask, 0}, {minusMask, 0, syscall.EPERM}, {plusMask, 0, syscall.EPERM}}))
	if !r.Passed || r.Calls != 5 {
		t.Fatal("bounded failed")
	}
}
func TestInitialQueryFailure(t *testing.T) {
	r := run("bounded", sequence(t, []answer{{queryMask, 0, syscall.EPERM}}))
	if r.Passed || r.Failure != "initial-query-failed" {
		t.Fatal("query failure accepted")
	}
}
func TestInitialNonzeroRejected(t *testing.T) {
	r := run("bounded", sequence(t, []answer{{queryMask, 8, 0}}))
	if r.Passed || r.Failure != "initial-personality-not-zero" {
		t.Fatal("nonzero initial accepted")
	}
}
func TestBoundedDenied(t *testing.T) {
	r := run("bounded", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, syscall.EPERM}}))
	if r.Passed || r.Failure != "bounded-mask-not-allowed" {
		t.Fatal("denied bounded accepted")
	}
}
func TestRestoreFailure(t *testing.T) {
	r := run("bounded", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, 0}, {0, 0, syscall.EPERM}}))
	if r.Passed || r.Failure != "restore-failed" {
		t.Fatal("failed restore accepted")
	}
}
func TestBaselineUnexpectedAllowRestores(t *testing.T) {
	r := run("baseline", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, 0}, {0, approvedMask, 0}}))
	if r.Passed || r.Failure != "baseline-mask-not-denied-eperm" {
		t.Fatal("baseline allow accepted")
	}
}
func TestWrongErrnoRejected(t *testing.T) {
	r := run("baseline", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, syscall.EINVAL}}))
	if r.Passed {
		t.Fatal("wrong errno accepted")
	}
}
func TestUnexpectedPreviousValueRestores(t *testing.T) {
	r := run("bounded", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 8, 0}, {0, approvedMask, 0}}))
	if r.Passed || r.Failure != "unexpected-personality-result" {
		t.Fatal("unexpected previous accepted")
	}
}
func TestMinusControlAllowedRestores(t *testing.T) {
	r := run("baseline", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, syscall.EPERM}, {minusMask, 0, 0}, {0, minusMask, 0}}))
	if r.Passed || r.Failure != "control-mask-not-denied-eperm" {
		t.Fatal("allowed control accepted")
	}
}
func TestPlusControlWrongErrno(t *testing.T) {
	r := run("baseline", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, syscall.EPERM}, {minusMask, 0, syscall.EPERM}, {plusMask, 0, syscall.EINVAL}}))
	if r.Passed {
		t.Fatal("wrong control errno accepted")
	}
}
func TestControlRestoreFailure(t *testing.T) {
	r := run("baseline", sequence(t, []answer{{queryMask, 0, 0}, {approvedMask, 0, syscall.EPERM}, {minusMask, 0, 0}, {0, 0, syscall.EPERM}}))
	if r.Passed || r.Failure != "restore-failed" {
		t.Fatal("control restore failure accepted")
	}
}
func TestInvalidModeNoSyscallOrPrivateOutput(t *testing.T) {
	r := run("private/path-or-env", func(uint64) (uint64, syscall.Errno) { t.Fatal("invalid mode made syscall"); return 0, 0 })
	b, _ := json.Marshal(r)
	if r.Passed || r.Calls != 0 || strings.Contains(string(b), "private") {
		t.Fatal("invalid mode disclosure or execution")
	}
}
func TestExactMasks(t *testing.T) {
	if approvedMask != 0x0ffc0000 || minusMask != 0x0ff80000 || plusMask != 0x1ffc0000 {
		t.Fatal("mask mismatch")
	}
}
