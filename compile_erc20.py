from solcx import compile_source, install_solc, set_solc_version
import json

# Install dan set versi solc (hanya perlu dijalankan sekali, tapi aman kalau tetap disertakan)
install_solc('0.8.19')
set_solc_version('0.8.19')  # Set default solc version

source_code = '''
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract RifsToken {
    string public name = "Sponge Token";
    string public symbol = "SPG";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint256 initialSupply) {
        balanceOf[msg.sender] = initialSupply;
        totalSupply = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function transfer(address recipient, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public returns (bool) {
        require(balanceOf[sender] >= amount, "Insufficient balance");
        require(allowance[sender][msg.sender] >= amount, "Allowance exceeded");
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        allowance[sender][msg.sender] -= amount;
        emit Transfer(sender, recipient, amount);
        return true;
    }
}
'''

compiled = compile_source(source_code, output_values=["abi", "bin"])
contract_id, contract_interface = compiled.popitem()

with open("erc20-abi.json", "w") as f:
    json.dump(contract_interface['abi'], f, indent=2)

with open("erc20-bytecode.json", "w") as f:
    json.dump({"bytecode": contract_interface['bin']}, f, indent=2)
