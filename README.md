# Gnosis Protocol Relayer

A relayer that enables DAOs to swap tokens on Gnosis Protocol using on-chain price oracles from Swapr or Uniswap.

## Local Development

The following assumes the use of `node@>=10`.

## Clone Repository

`git clone https://github.com/nicoelzer/gnosis-protocol-relayer.git`

## Install Dependencies

`yarn`

## Setup .env file

Create new .env file and configure variables accordingly:
```bash
PRIVATE_KEY=""
INFURA_KEY=""
```

## Compile Contracts

`yarn build`

## Run Tests

`yarn test`

## Flatten Contracts

`yarn flattener`

## Deploy Contracts

Deploy on Mainnet:
`yarn deploy`

Deploy on xDAI:
`yarn deploy:xdai`