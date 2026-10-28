#!/usr/bin/env bash
# A Spring Boot service at api/ that has not adopted the workflow yet.
set -euo pipefail
mkdir -p api/src/main/kotlin/com/acme
cat > api/build.gradle.kts <<'KTS'
plugins {
    kotlin("jvm") version "2.2.0"
    id("org.springframework.boot") version "4.0.0"
}
KTS
cat > api/src/main/kotlin/com/acme/App.kt <<'KT'
package com.acme

fun main() {}
KT
printf '# Acme\n\nAcme bills Globex for widgets.\n' > CLAUDE.md
