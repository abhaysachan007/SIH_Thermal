@echo off
cd /d "d:\SIH\simulation\jobs\preview_job"
"D:\\ANSYS Inc\\ANSYS Student\\v261\\ansys\\bin\\winx64\\MAPDL.exe" -g -p ansys -dir "d:\SIH\simulation\jobs\preview_job" -i build_and_show.apdl
