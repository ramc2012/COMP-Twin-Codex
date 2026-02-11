import json

with open('clean_registers.json', 'r') as f:
    registers = json.load(f)

ts_content = "export interface RegisterDef {\n"
ts_content += "  address: number;\n"
ts_content += "  name: string;\n"
ts_content += "  description: string;\n"
ts_content += "  unit: string;\n"
ts_content += "  category: string;\n"
ts_content += "  type: 'Analog' | 'Discrete';\n"
ts_content += "  min: number;\n"
ts_content += "  max: number;\n"
ts_content += "  defaultValue: number;\n"
ts_content += "}\n\n"

ts_content += "export const initialRegisters: RegisterDef[] = " + json.dumps(registers, indent=2) + ";"

with open('frontend/src/data/initialRegisters.ts', 'w') as f:
    f.write(ts_content)
