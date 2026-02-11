import json

try:
    with open('registers.json', 'r') as f:
        raw_data = json.load(f)

    registers = []
    analog_counter = 40001
    discrete_counter = 40100

    def get_category(name):
        if not name: return "General"
        name = str(name).lower()
        if "engine" in name: return "Engine"
        if "compressor" in name or "cyl" in name or "stg" in name: return "Compressor"
        if "vib" in name: return "Vibration"
        if "temp" in name: return "Temperature"
        if "valve" in name: return "Valves"
        return "General"

    def get_unit(signal_type):
        if not signal_type: return ""
        signal_type = str(signal_type)
        if "4-20" in signal_type: return "PSIG" 
        if "T/C" in signal_type: return "°F"
        if "DI" in signal_type or "DO" in signal_type: return "State"
        return ""

    seen_names = set()

    for row in raw_data:
        id_val = row.get("Terminal Board Quantity:")
        name = row.get("Unnamed: 1")
        sig_type = row.get("1")
        
        # Skip if name is one of the headers
        if str(name) in ["INPUT NAME / FUNCTION", "OUTPUT NAME / FUNCTION"]:
            continue
            
        # Check if spare or not used
        is_spare = False
        if name and "SPARE" in str(name).upper(): is_spare = True
        if sig_type and "NOT USED" in str(sig_type).upper(): is_spare = True
        if id_val and "SPARE" in str(id_val).upper(): is_spare = True
        
        # Also check all values in row just in case "Not Used" is buried somewhere
        # But for now specific columns are safer to avoid false positives
        
        if is_spare: continue
        
        # Must have at least a Name or an ID that isn't just a header
        if not name and not id_val: continue
        
        # Skip purely empty rows (where name is None) that might be spacing
        if not name and not sig_type: continue

        # Dedup
        if name in seen_names: continue
        if name: seen_names.add(name)

        is_analog = False
        st_str = str(sig_type).upper() if sig_type else ""
        nm_str = str(name).upper() if name else ""
        id_str = str(id_val).upper() if id_val else ""

        if "4-20" in st_str or "T/C" in st_str or "ANALOG" in st_str or "J/K" in st_str:
            is_analog = True
        elif ("RPM" in nm_str or "TEMP" in nm_str or "PRESSURE" in nm_str or "VIBRATION" in nm_str) and "SWITCH" not in nm_str:
             # If it's a switch, it's likely discrete even if it says pressure
             is_analog = True
        elif "AO" in id_str:
             is_analog = True

        if is_analog:
            reg = {
                "address": analog_counter,
                "name": name if name else f"{id_val} Param",
                "description": f"{id_val if id_val else ''} - {sig_type if sig_type else 'Analog'}",
                "unit": get_unit(sig_type),
                "category": get_category(name),
                "type": "Analog",
                "min": 0, "max": 1000,
                "defaultValue": 0
            }
            analog_counter += 1
        else:
            reg = {
                "address": discrete_counter,
                "name": name if name else f"{id_val} State",
                "description": f"{id_val if id_val else ''} - {sig_type if sig_type else 'Discrete'}",
                "unit": "State",
                "category": get_category(name),
                "type": "Discrete",
                "min": 0, "max": 1,
                "defaultValue": 0
            }
            discrete_counter += 1
        
        registers.append(reg)

    with open('clean_registers.json', 'w') as f:
        json.dump(registers, f, indent=2)

    print(f"Processed {len(registers)} registers.")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

