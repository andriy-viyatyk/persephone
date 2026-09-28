#!/bin/bash
# US-1557 local test VPN: a WireGuard "provider" in the root namespace and an
# isolated "client" namespace (vpn) whose only allowed egress is the tunnel.
#   testvpn up | down | tunnel-down | tunnel-up | status | dns <upstream-ip>
set -e
NS=vpn
DIR=/etc/testvpn
# Upstream for the provider resolver; read by testvpn-dns.service as $DNS_UPSTREAM.
DNS_ENV="$DIR/dns.env"

set_dns() {
    [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "usage: testvpn dns <IPv4 address>"; exit 1; }
    dig +short +time=3 +tries=1 @"$1" example.com | grep -qv '^;' || { echo "DNS $1 does not answer; not switching"; exit 1; }
    echo "DNS_UPSTREAM=$1" > "$DNS_ENV"
    systemctl restart testvpn-dns
    echo "test VPN resolver now forwards to $1"
}

keys() {
    mkdir -p "$DIR"; chmod 700 "$DIR"
    for side in server client; do
        [ -f "$DIR/$side.key" ] || (umask 077; wg genkey > "$DIR/$side.key")
        wg pubkey < "$DIR/$side.key" > "$DIR/$side.pub"
    done
}

up() {
    keys
    ip netns list | grep -qw "$NS" && down
    sysctl -qw net.ipv4.ip_forward=1

    # Underlay: veth pair = the client machine's ordinary "ISP" link.
    ip netns add "$NS"
    ip link add veth-srv type veth peer name veth-cli
    ip link set veth-cli netns "$NS"
    ip addr add 10.200.0.1/30 dev veth-srv
    ip link set veth-srv up
    ip -n "$NS" link set lo up
    ip -n "$NS" addr add 10.200.0.2/30 dev veth-cli
    ip -n "$NS" link set veth-cli up
    ip netns exec "$NS" sysctl -qw net.ipv6.conf.all.disable_ipv6=1
    # Fallback default route over the underlay: exists so the kill switch is what blocks it.
    ip -n "$NS" route add default via 10.200.0.1 metric 200

    # "VPN provider" WireGuard server.
    ip link add wg-srv type wireguard
    wg set wg-srv listen-port 51820 private-key "$DIR/server.key" \
        peer "$(cat "$DIR/client.pub")" allowed-ips 10.99.0.2/32
    ip addr add 10.99.0.1/24 dev wg-srv
    ip link set wg-srv up

    # Client tunnel, created inside the namespace so its UDP socket uses the underlay.
    ip -n "$NS" link add wg0 type wireguard
    ip netns exec "$NS" wg set wg0 private-key "$DIR/client.key" \
        peer "$(cat "$DIR/server.pub")" endpoint 10.200.0.1:51820 allowed-ips 0.0.0.0/0 persistent-keepalive 25
    ip -n "$NS" addr add 10.99.0.2/32 dev wg0
    ip -n "$NS" link set wg0 up
    ip -n "$NS" route add default dev wg0 metric 50

    # Provider side NAT: tunnel and underlay both leave through eth0.
    nft -f - <<EOF
table ip testvpn_nat {
    chain post { type nat hook postrouting priority 100; policy accept;
        ip saddr { 10.99.0.0/24, 10.200.0.0/30 } oifname "eth0" masquerade
    }
}
EOF

    # Client kill switch: only loopback, the tunnel, and the tunnel's own UDP to the endpoint.
    ip netns exec "$NS" nft -f - <<EOF
table inet killswitch {
    chain output { type filter hook output priority 0; policy drop;
        oif lo accept
        oifname "wg0" accept
        oifname "veth-cli" ip daddr 10.200.0.1 udp dport 51820 accept
        ct state established,related accept
        counter comment "blocked egress"
    }
    chain input { type filter hook input priority 0; policy drop;
        iif lo accept
        ct state established,related accept
        iifname "veth-cli" ip saddr 10.200.0.1 tcp dport 1080 accept
        counter comment "blocked ingress"
    }
}
EOF

    # Client resolver = provider resolver, reachable only through the tunnel.
    mkdir -p /etc/netns/"$NS"
    echo "nameserver 10.99.0.1" > /etc/netns/"$NS"/resolv.conf
}

down() {
    ip netns exec "$NS" ip link del wg0 2>/dev/null || true
    ip netns del "$NS" 2>/dev/null || true
    ip link del wg-srv 2>/dev/null || true
    ip link del veth-srv 2>/dev/null || true
    nft delete table ip testvpn_nat 2>/dev/null || true
}

case "$1" in
    up) up ;;
    down) down ;;
    tunnel-down) ip -n "$NS" link set wg0 down; echo "tunnel down (kill switch should block)";;
    tunnel-up) ip -n "$NS" link set wg0 up; ip -n "$NS" route replace default dev wg0 metric 50; echo "tunnel up";;
    dns) set_dns "$2" ;;
    status)
        echo "DNS upstream: $(sed -n 's/^DNS_UPSTREAM=//p' "$DNS_ENV" 2>/dev/null)"
        wg show
        echo "--- client routes:"; ip -n "$NS" route
        echo "--- kill switch counters:"; ip netns exec "$NS" nft list chain inet killswitch output | grep counter
        ;;
    *) echo "usage: testvpn up|down|tunnel-down|tunnel-up|status|dns <ip>"; exit 1 ;;
esac
