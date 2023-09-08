#!/bin/bash

echo "#### Installing openapi spec validator ####"
pip3 install openapi-spec-validator

echo "#### Validating OpenAPI Spec ####"
OK=$(openapi-spec-validator ./docs/openapi.json)

if [[ $OK != "OK" ]]
then
  echo "#### OpenAPI Spec is invalid ####"
  echo "$OK"
  exit 1
fi

echo "OpenAPI Spec is Valid"
