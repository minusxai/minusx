//go:build linux && amd64

package main

import "syscall"

func platformPersonality(mask uint64) (uint64, syscall.Errno) {
	value, _, errno := syscall.RawSyscall(syscall.SYS_PERSONALITY, uintptr(mask), 0, 0)
	return uint64(value), errno
}
