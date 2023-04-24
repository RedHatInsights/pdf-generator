#!/bin/bash

set -exv

IMAGE="quay.io/cloudservices/crc-pdf-generator"
IMAGE_TAG=$(git rev-parse --short=7 HEAD)
SMOKE_TEST_TAG="latest"

if [[ -z "$QUAY_USER" || -z "$QUAY_TOKEN" ]]; then
    echo "QUAY_USER and QUAY_TOKEN must be set"
    exit 1
fi

if [[ -z "$RH_REGISTRY_USER" || -z "$RH_REGISTRY_TOKEN" ]]; then
    echo "RH_REGISTRY_USER and RH_REGISTRY_TOKEN  must be set"
    exit 1
fi

DOCKER_CONF="$PWD/.docker"
mkdir -p "$DOCKER_CONF"
DOCKER_CONFIG=$DOCKER_CONF docker login -u="$QUAY_USER" -p="$QUAY_TOKEN" quay.io
DOCKER_CONFIG=$DOCKER_CONF docker login -u="$RH_REGISTRY_USER" -p="$RH_REGISTRY_TOKEN" registry.redhat.io
DOCKER_CONFIG=$DOCKER_CONF docker build -t "${IMAGE}:${IMAGE_TAG}" .
DOCKER_CONFIG=$DOCKER_CONF docker push "${IMAGE}:${IMAGE_TAG}"

if [[ $GIT_BRANCH == *"security-compliance"* ]]; then
    docker --config="$DOCKER_CONF" tag "${IMAGE}:${IMAGE_TAG}" "${IMAGE}:security-compliance"
    docker --config="$DOCKER_CONF" push "${IMAGE}:security-compliance"
else
    DOCKER_CONFIG=$DOCKER_CONF docker tag "${IMAGE}:${IMAGE_TAG}" "${IMAGE}:${SMOKE_TEST_TAG}"
    DOCKER_CONFIG=$DOCKER_CONF docker push "${IMAGE}:${SMOKE_TEST_TAG}"
fi
