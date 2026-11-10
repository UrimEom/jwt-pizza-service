#!/usr/bin/env bash

if [ -z "$1" ]; then
  echo "Usage: bash generatePizzaTraffic.sh <host>"
  exit 1
fi

host="${1%/}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required."
  exit 1
fi

pids=()

cleanup() {
  trap - INT TERM EXIT
  echo
  echo "Stopping traffic..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
}

trap 'exit 0' INT TERM
trap cleanup EXIT

login() {
  curl -sS -X PUT "$host/api/auth" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" |
    jq -r '.token // empty'
}

logout() {
  curl -sS -o /dev/null -X DELETE "$host/api/auth" \
    -H "Authorization: Bearer $1"
}

# Request the menu every three seconds.
(
  while true; do
    status=$(curl -sS -o /dev/null -w '%{http_code}' \
      "$host/api/order/menu")
    echo "Requesting menu... $status"
    sleep 3
  done
) &
pids+=("$!")

# Attempt an invalid login every 25 seconds.
(
  while true; do
    status=$(curl -sS -o /dev/null -w '%{http_code}' \
      -X PUT "$host/api/auth" \
      -H 'Content-Type: application/json' \
      -d '{"email":"unknown@jwt.com","password":"bad"}')
    echo "Logging in with invalid credentials... $status"
    sleep 25
  done
) &
pids+=("$!")

# Log in as a franchisee, then log out.
(
  while true; do
    token=$(login "f@jwt.com" "franchisee")
    if [ -n "$token" ]; then
      echo "Login franchisee... true"
      sleep 110
      logout "$token"
      echo "Logging out franchisee..."
      sleep 10
    else
      echo "Login franchisee... false"
      sleep 120
    fi
  done
) &
pids+=("$!")

# Log in, buy one pizza, and log out.
(
  while true; do
    token=$(login "d@jwt.com" "diner")
    if [ -n "$token" ]; then
      echo "Login diner... true"
      status=$(curl -sS -o /dev/null -w '%{http_code}' \
        -X POST "$host/api/order" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $token" \
        -d '{"franchiseId":1,"storeId":1,"items":[
          {"menuId":1,"description":"Veggie","price":0.05}
        ]}')
      echo "Bought a pizza... $status"
      sleep 20
      logout "$token"
      echo "Logging out diner..."
      sleep 30
    else
      echo "Login diner... false"
      sleep 50
    fi
  done
) &
pids+=("$!")

# Attempt to order 22 pizzas.
(
  while true; do
    token=$(login "d@jwt.com" "diner")
    if [ -n "$token" ]; then
      echo "Login hungry diner... true"

      items='{"menuId":1,"description":"Veggie","price":0.05}'
      for ((i=0; i<21; i++)); do
        items+=',{"menuId":1,"description":"Veggie","price":0.05}'
      done

      status=$(curl -sS -o /dev/null -w '%{http_code}' \
        -X POST "$host/api/order" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $token" \
        -d "{\"franchiseId\":1,\"storeId\":1,\"items\":[$items]}")
      echo "Bought too many pizzas... $status"

      sleep 5
      logout "$token"
      echo "Logging out hungry diner..."
      sleep 295
    else
      echo "Login hungry diner... false"
      sleep 300
    fi
  done
) &
pids+=("$!")

wait