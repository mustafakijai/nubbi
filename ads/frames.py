import json,subprocess,sys,os
rec=sys.argv[1]; out=sys.argv[2]; off=float(sys.argv[3]) if len(sys.argv)>3 else 0.4
st=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=start_time','-of','csv=p=0',rec+'/raw.mkv']).decode().strip())
os.makedirs(out,exist_ok=True)
for l in open(rec+'/markers.jsonl'):
    m=json.loads(l); t=m['t']/1000-st+off
    subprocess.run(['ffmpeg','-loglevel','fatal','-y','-ss',str(t),'-i',rec+'/raw.mkv','-frames:v','1','-vf','scale=1440:-1',f"{out}/{m['name']}.png"])
    print(m['name'],round(t,2))
