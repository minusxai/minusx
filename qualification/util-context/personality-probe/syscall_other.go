//go:build !linux || !amd64

package main

import "syscall"

// Host-native unit tests inject a fake. Unsupported real probing fails closed.
func platformPersonality(mask uint64) (uint64, syscall.Errno) {
	return 0, syscall.ENOSYS
}
