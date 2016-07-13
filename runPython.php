<?php 
$script = $_POST['script'];
$source = $_POST['source'];

$command = escapeshellcmd('python ' . $script . ' ' . $source);
$output = shell_exec($command);
echo $output;

?>
